# Homelab Dashboard — Handover

This document captures the state of the project, the major work done, and the
hard-won gotchas (especially around Apache Guacamole) so the next person — or
future you — can pick it up without rediscovering everything.

- **Repo:** https://github.com/Kobii-git/homelab-dashboard (private)
- **Image:** `ghcr.io/kobii-git/homelab-dashboard` (GHCR, private)
- **Current version:** see [`package.json`](package.json) / [CHANGELOG.md](CHANGELOG.md)
- **Port:** `4173`

---

## 1. What it is

A private, self-hosted homelab command centre. Single admin account. Runs over
plain HTTP on a LAN (put a reverse proxy in front for HTTPS).

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript (`src/client/`) |
| Backend | Fastify 5 + Zod + TypeScript (`src/server/`) |
| Database | SQLite via Prisma (`prisma/schema.prisma`) |
| Vault | AES-256-GCM, Node `crypto` (`src/server/vault.ts`) |
| Remote access | Apache Guacamole `guacd` + `guacamole-common-js` (`src/server/guacamole.ts`) |
| Deploy | Docker Compose / GHCR |

**Views (sidebar):** Dashboard · SSH · Remote Desktop · Monitoring · Vault ·
Alerts · Inventory · Settings.

---

## 2. Deploy & run

### Build from source on the Docker host (keeps data)

```sh
cd ~/homelab
git pull
docker compose -f docker-compose.build.yml up -d --build
```

If you hit a container name conflict (`/homelab-guacd already in use`):

```sh
docker compose -f docker-compose.build.yml down       # KEEPS the volume
docker rm -f homelab-guacd homelab-dashboard 2>/dev/null
docker compose -f docker-compose.build.yml up -d --build
```

> **Data lives in the named Docker volume `homelab-dashboard-data`.** It survives
> `down`, `rm`, and `up`. It is **only** destroyed by `down -v` or `docker volume rm`.
> Never use `-v` unless you intend to wipe everything.

### Pull the prebuilt image (alternative)

The image is private, so authenticate once per machine:

```sh
echo <GH_PAT_with_read:packages> | docker login ghcr.io -u Kobii-git --password-stdin
docker compose up -d
```

### First run

On the first visit you get a **setup screen**: create a username + password and
optionally load demo data. No environment variables are required — the cookie
secret and vault key auto-generate and persist in the DB.

---

## 3. The work done (feature arc)

Roughly in order, across the development sessions:

1. **v0.1.0 — initial release.** Full dashboard: resources/groups, health checks
   (HTTP/TCP/ping), incidents, maintenance windows, alert channels/rules/deliveries,
   AES-256-GCM vault, browser SSH/RDP via guacd, session history, audit log, notes,
   command palette. Docker + GHCR + GitHub Actions release workflow + issue templates.
2. **UI pass.** Favorites section, explicit Details button, incident history,
   recent-sessions strip, working folder filters, conditional alert forms,
   incident mute, maintenance-window form, vault edit + auto-hiding secrets,
   inventory edit/delete with confirmations, notes management, palette nav for all views.
3. **Zero-config install.** Removed the requirement for env vars. Web-based admin
   account creation (scrypt→pbkdf2 hash in `AdminAccount`); `COOKIE_SECRET` /
   `HOMELAB_VAULT_KEY` auto-generated into `SystemConfig`. Added a username field.
4. **The SSH/RDP saga** (this is the big one — see §4).
5. **Session UI.** Display scales to fit the panel + dynamic resize, status dot,
   connecting spinner, fullscreen, tab dedupe + "Clear ended", RDP login handling,
   failed-state credential hints.
6. **Session input.** Paste-to-type box (works over HTTP), Ctrl+Alt+Del for RDP,
   best-effort clipboard sync.
7. **Housekeeping.** Synced CHANGELOG/README versions, `.gh-bin/` gitignored,
   fixed flaky test suite.

---

## 4. Guacamole tunnel — read this before touching remote access

This took several iterations. The core file is
[`src/server/guacamole.ts`](src/server/guacamole.ts) (`wireGuacamoleTunnel`) and
[`src/client/components/GuacamoleDisplay.tsx`](src/client/components/GuacamoleDisplay.tsx).

**Architecture:** browser (`guacamole-common-js`) ⇄ `/api/tunnel` WebSocket ⇄
our Node tunnel ⇄ `guacd` TCP (4822) ⇄ the SSH/RDP target.

### The four bugs that made SSH/RDP "never work", in the order they surfaced:

1. **The server must drive the guacd handshake.** `guacamole-common-js`'s
   `client.connect()` only opens the tunnel and waits — it sends **no**
   `select`/`size`/`connect`. The original code waited for the *browser* to send
   `connect`, while guacd waited for `select` → deadlock → guacd timeout. The
   server now performs the full handshake:
   `select,<protocol>` → read `args` → `size`/`audio`/`video`/`image`/`timezone`
   → `connect,<value per arg>` (vault creds injected) → guacd replies `ready`.

2. **Negotiate the protocol version DOWN to 1.1.0.** Echoing guacd's offered
   `VERSION_1_5_0` back caused timeouts. The reference implementation
   (`guacamole-lite`) clamps to `1_1_0` (the handshake it fully implements). We do
   the same and send `timezone` for 1.1.0.

3. **Relay the connection id as the empty-opcode tunnel instruction.** On `ready`,
   send `["", connectionId]` (encodes to `0.,N.<id>;`) — `guacamole-common-js`
   expects this. Consume `ready` rather than forwarding it.

4. **Send TEXT WebSocket frames, never binary.** This was the final blank-screen
   bug: the handshake completed (guacd logged "user joined") but the browser
   stayed on "Waiting" with no terminal/login prompt. `ws.send(Buffer)` defaults
   to a **binary** frame, and `guacamole-common-js`'s WebSocketTunnel **silently
   drops binary frames**. Every render instruction — including guacd's SSH
   `Login as:` prompt and the RDP login screen — was discarded. Fix: `sendToClient`
   uses `ws.send(buf, { binary: false })`. guacd output is valid UTF-8 so it's
   lossless. The tunnel test asserts every browser-bound frame is text.

### Other tunnel facts

- **Mouse:** `guacamole-common-js` 1.5 uses `mouse.onEach([...], e => client.sendMouseState(e.state, true))`. The `true` flag auto-divides coordinates by `display.getScale()`, so scaled-to-fit clicks land correctly.
- **Display sizing:** `client.sendSize(w, h)` on connect + on resize (ResizeObserver, debounced) asks the remote to match the container; `display.scale(...)` fits whatever it renders.
- **Credentials / prompts:**
  - SSH with no credential → guacd shows an interactive `Login as:` / `Password:` prompt in the terminal.
  - RDP with **no password** → we set `security=rdp` (legacy, no NLA) so the Windows login screen appears; **with** a password → `security=any` for NLA/TLS. `ignore-cert=true` always.
- **Diagnostics:** the tunnel logs each stage tagged `[guac <proto> <host>:<port>]`. `docker logs homelab-dashboard | grep guac` shows where a session stalls. `docker logs homelab-guacd` shows guacd's own reason (auth failure, unreachable host, etc.).
- **Paste-to-type:** the browser clipboard API is blocked over plain HTTP, so the session toolbar's paste box types text as keystrokes via `src/client/lib/keysyms.ts` (char → X11 keysym). This is the reliable path on a LAN.

---

## 5. Auth & secrets

- **Cookie:** `COOKIE_SECURE` defaults to **false**. A `Secure` cookie is dropped
  by browsers over plain HTTP, which silently breaks login (you can "log in" but
  the session never sticks). Only set `COOKIE_SECURE=true` behind HTTPS.
  ([`src/server/env.ts`](src/server/env.ts), `app.ts` login route.)
- **Admin account:** pbkdf2 hash in the `AdminAccount` table. `ADMIN_PASSWORD`
  env var still works (bypasses web account creation; Settings shows auth source).
- **Auto-generated secrets:** `cookie_secret` and `vault_key` are generated on
  first boot and stored in `SystemConfig` (`src/server/index.ts` `resolveSecrets`).
  Pin them via env vars if you want sessions to survive a DB reset.
- **Public (no-auth) API routes:** login, me, health, version, setup/status,
  setup, status, tunnel.

---

## 6. Tests

```sh
npm test          # 23 tests across 7 files
npm run typecheck
npm run build
```

- All test files share **one** `DATABASE_URL` (set in the `npm test` script), so
  vitest runs them **sequentially** (`fileParallelism: false` in `vitest.config.ts`).
  Without that, the suite was intermittently flaky (vault-reveal racing).
- `tests/guacamoleTunnel.test.ts` is a mock-guacd integration test: it asserts
  the server sends `select`, answers `args` with `connect` (creds injected,
  version clamped), relays both ways, and **only ever sends text frames**.
- `tests/keysyms.test.ts` covers the char→keysym mapping (ASCII, control keys,
  non-Latin Unicode, surrogate-pair emoji).

---

## 7. Versioning & release

- Semver in `package.json`. CHANGELOG and the README version badges are kept in sync.
- Pushing a `v*` tag triggers the GitHub Actions workflow to build and publish a
  versioned image to GHCR.

```sh
npm version patch --no-git-tag-version   # or minor / major
# update CHANGELOG.md + README version refs
git add -A && git commit -m "..." && git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

---

## 8. Known limitations / gotchas

- **Single admin only.** No multi-user.
- **Plain HTTP by design.** No built-in HTTPS; use a reverse proxy. Remember
  `COOKIE_SECURE=true` if you do.
- **guacd must reach the targets.** guacd runs in the container; it needs a network
  route to your SSH/RDP hosts. `docker exec homelab-guacd nc -zv <host> <port>` to check.
- **RDP + NLA.** A Windows host that *requires* NLA won't show a login screen even
  with `security=rdp`; you must attach a valid credential.
- **Private GHCR/repo.** Pulling the image or cloning needs a GitHub PAT.
- The `gh` CLI used for pushes during development was downloaded to `/tmp` (cleaned
  between sessions); git push still works via cached credentials.

---

## 9. Suggested next steps

- **Configurable dashboard widgets** — the `DashboardWidget` model and a
  `WidgetSettings` component exist, but the dashboard still renders a hardcoded set.
- **Send a vault password straight into a session** (one-click "paste credential").
- **Visual polish on non-session views** (Dashboard / Monitoring / Vault / Inventory).
- **Real end-to-end remote-access test** with a guacd container + a test SSH/RDP
  target (local Docker wasn't available when the tunnel was fixed, so it's only
  covered by the mock-guacd integration test).
