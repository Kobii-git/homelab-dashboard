# Homelab Dashboard

A private, self-hosted command centre for your homelab. Launch SSH/RDP sessions in the browser, monitor service health, manage an encrypted credential vault, and get alerted when things break.

![Version](https://img.shields.io/badge/version-0.2.11-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Dashboard** — grouped resource cards, status widgets, favorites
- **Remote Access** — browser-based SSH and RDP via Apache Guacamole `guacd`
- **Monitoring** — HTTP, TCP, and ping health checks with auto-incident creation
- **Vault** — AES-256-GCM encrypted credentials with folders and tags
- **Alerts** — webhook/email channels with rules, cooldowns, and delivery history
- **Inventory** — full CRUD for resources, connections, checks, and credentials
- **Command palette** — global search across everything (Ctrl K or `/`)

> **New here?** See [HANDOVER.md](HANDOVER.md) for the full architecture, the
> Guacamole tunnel gotchas, and how everything fits together.

---

## Quick start with Docker (recommended)

**No configuration required.** The app sets itself up on first boot.

### Authenticate to the private image registry (once per machine)

```sh
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u Kobii-git --password-stdin
```

Create a GitHub PAT with `read:packages` scope at https://github.com/settings/tokens/new.
This is stored in `~/.docker/config.json` — you only need to do it once per machine.

### Install — one command

```sh
curl -fsSL https://raw.githubusercontent.com/Kobii-git/homelab-dashboard/main/docker-compose.yml \
  -o /tmp/homelab.yml && docker compose -f /tmp/homelab.yml up -d
```

Open **http://localhost:4173**. On first visit you'll be prompted to **create a password** and
optionally load demo data — no env vars needed.

### What the first-run screen does

1. You choose a password for the admin account (stored as a salted scrypt hash in the database)
2. A toggle lets you load demo data to explore the full feature set
3. The cookie signing key and vault encryption key are auto-generated and persisted in the
   database — nothing to write down or back up separately

### Pinning secrets (optional, recommended for production)

If you want to be explicit — or ensure sessions survive container restarts — add these to
`docker-compose.yml` under `environment:`:

```yaml
ADMIN_PASSWORD: your-password        # bypasses the web account creation screen
COOKIE_SECRET: random-32-char-string # persistent sessions across restarts
HOMELAB_VAULT_KEY: random-key        # bring your own vault encryption key
```

---

## First-run demo data

On the first login after a fresh install, the dashboard detects that no resources exist and shows a **first-run setup screen**. A toggle lets you choose whether to load demo data before entering the dashboard.

The demo data includes sample resources, grouped by category, with health checks, SSH/RDP connections, an encrypted credential vault, an open incident, alert channel, and a pinned note — everything needed to explore the full feature set.

The choice is recorded in the database. The setup screen will not appear again once dismissed.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | No | Skip web account creation and use this password instead |
| `COOKIE_SECRET` | No | Signs session cookies — auto-generated if unset (sessions reset on restart) |
| `COOKIE_SECURE` | No | Set to `true` only if serving over HTTPS. Default `false` for plain-HTTP LAN access |
| `HOMELAB_VAULT_KEY` | No | Vault encryption key — auto-generated and persisted in DB if unset |
| `DATABASE_URL` | No | Prisma SQLite path — default `file:/data/homelab.db` |
| `GUACD_HOST` | No | `guacd` host — default `guacd` in Docker |
| `GUACD_PORT` | No | `guacd` port — default `4822` |
| `PORT` | No | HTTP port — default `4173` |

> Keep this on a LAN, VPN, or private mesh network. There is no multi-user auth or HTTPS termination built in — put a reverse proxy (nginx, Caddy, Traefik) in front if exposing beyond localhost.

---

## Updating

```sh
docker compose pull
docker compose up -d
```

The database is persisted in a named volume (`homelab-dashboard-data`) and survives updates.

---

## Remote access setup

SSH and RDP sessions open in the browser through [Apache Guacamole](https://guacamole.apache.org/). The `guacd` container is included in `docker-compose.yml`.

To launch a session:
1. Add a **Resource** in Inventory (the server or VM)
2. Add a **Connection** to that resource (SSH on port 22, or RDP on port 3389)
3. Optionally attach a **Credential** from the vault so the password is filled automatically
4. Click the connection in the **Access** view

Credentials are decrypted server-side only at the moment of the Guacamole handshake — they are never sent to the browser.

---

## Local development

```sh
git clone https://github.com/Kobii-git/homelab-dashboard
cd homelab-dashboard
npm install
cp .env.example .env    # set secrets
npm run db:push
npm run dev:all         # API on :3000, frontend on :5173
```

Optional demo data:

```sh
HOMELAB_VAULT_KEY=dev-vault-key-change-me DATABASE_URL=file:../data/homelab.db npm run seed:demo
```

### Useful commands

| Command | Description |
|---|---|
| `npm run dev:all` | Start API and Vite dev server concurrently |
| `npm run build` | Production build |
| `npm test` | Run test suite |
| `npm run typecheck` | TypeScript type check |
| `npm run db:push` | Apply schema to SQLite |
| `npm run db:studio` | Open Prisma Studio |
| `npm run seed:demo` | Load demo data (needs env vars) |

### Building the Docker image locally

```sh
docker compose -f docker-compose.build.yml up -d --build
```

---

## Stack

| Component | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma ORM |
| Remote access | Apache Guacamole `guacd` + `guacamole-common-js` |
| Vault | AES-256-GCM (Node.js built-in `crypto`) |
| Container | Docker / GHCR |

---

## Versioning

Releases follow [Semantic Versioning](https://semver.org). See [CHANGELOG.md](CHANGELOG.md) for the full history.

Current: **v0.2.11**

### Verify your running build

| Where | What to look for |
|---|---|
| **Sidebar** (bottom) | `v0.2.11 · abc1234` — click for GitHub release notes |
| **Login screen** | Same badge under the Unlock button |
| **`/status` page** | Version line under the title |
| **API** | `curl -s http://localhost:4173/api/version` |

The short hash (`abc1234`) is the git commit baked into the Docker image at build time.

### Release a new version

```sh
# 1. Bump version + update CHANGELOG.md
npm version patch   # or minor / major

# 2. Commit, tag, and push
git push && git push origin v$(node -p "require('./package.json').version")
```

Pushing a `v*` tag creates a [GitHub Release](https://github.com/Kobii-git/homelab-dashboard/releases) and publishes a matching Docker image to GHCR.
