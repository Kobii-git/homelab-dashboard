# Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.9] - 2026-06-04

### Added
- **Remote session display now fills the panel and resizes dynamically.** The SSH terminal / RDP desktop scales to fit the session area and asks the remote to match the container size on launch and on window resize (no more fixed 1024×768 with wasted black space). Mouse input is scale-corrected via `sendMouseState(state, true)`.
- **Cleaner session toolbar** with a live status dot (connecting/connected/error), a connecting spinner, and an in-display fullscreen toggle.
- **"Clear ended" action** on the session tab bar to dismiss all failed/closed tabs at once.

### Changed
- **Relaunching a device replaces its stale tab** instead of stacking duplicate "Failed" tabs.
- **RDP with no password** now uses legacy RDP security to present the Windows login screen instead of failing NLA outright; with a password, guacd negotiates NLA/TLS as before.
- **Failed sessions** show a credential hint for auth errors plus an **Edit device** shortcut to fix the attached credential.

---

## [0.2.8] - 2026-06-04

### Fixed
- **SSH/RDP showed a blank screen stuck on "Waiting" (no terminal, no login prompt).** The guacd handshake was completing (guacd reported the session as established), but the render stream was being forwarded to the browser as **binary** WebSocket frames. `guacamole-common-js` only parses **text** frames and silently discards binary ones, so nothing ever rendered — including guacd's interactive SSH login prompt and the RDP login screen. All guacd→browser traffic is now sent as text frames. SSH connections without a stored credential now correctly show guacd's interactive `Login as:` / `Password:` prompt; RDP shows the remote login screen.

---

## [0.2.7] - 2026-06-04

### Fixed
- **SSH/RDP still timed out after 0.2.6.** Aligned the server-driven handshake with the reference `guacamole-lite` implementation:
  - **Negotiate the protocol version down to 1.1.0** instead of echoing guacd's offered `VERSION_1_5_0` (the proxy only fully implements the 1.1.0 handshake), and send the `timezone` instruction for 1.1.0.
  - On `ready`, relay guacd's connection id to the browser as the **empty-opcode tunnel instruction** `guacamole-common-js` expects, and consume `ready` rather than forwarding it.
  - Forward render bytes that share guacd's `ready` TCP segment; declare audio mimetypes in the handshake.
  - **Surface guacd's real error text** to the browser (so a failed target connection shows the actual reason instead of a generic timeout), and log each handshake stage to the container log for diagnosis.

---

## [0.2.6] - 2026-06-04

### Fixed
- **SSH and RDP never connected** ("connection lost", with or without vault credentials). `guacamole-common-js` does not perform the guacd handshake itself — it opens the tunnel and waits for the server to stream a fully-connected session. The tunnel was instead waiting for the *browser* to send the `connect` instruction, so it deadlocked against guacd (which waits for `select`) until guacd timed out. The server now drives the full handshake: `select` → reads `args` → sends `size`/`audio`/`video`/`image` → `connect` (with vault credentials and version negotiation injected) → relays the render stream both ways. Added a 15s handshake timeout and a mock-guacd integration test.

### Changed
- `.gh-bin/` ignored; CHANGELOG and README version references brought in line with `package.json`.

---

## [0.2.5] - 2026-06-04

### Fixed
- Guacamole **server timeout during SSH/RDP handshake** — forward guacd handshake traffic to the browser and only rewrite the `connect` instruction to inject vault credentials. (Superseded by the full server-driven handshake in 0.2.6.)

---

## [0.2.4] - 2026-06-04

### Fixed
- **RDP/SSH tunnel handshake and session token lookup** — relay client WebSocket traffic to guacd from the start, allow tunnel auth via session-id fallback, and mark failed sessions so reconnect gets a fresh token.

---

## [0.2.3] - 2026-06-04

### Added
- **Settings** page — change password, Sync, Backup, Status page
- **Edit device** on SSH / Remote Desktop device list (host, port, credential, notes)
- **Monitor** button on devices — one-click TCP health check

### Fixed
- **Invalid or expired session token** — tokens no longer deleted when the WebSocket closes; sessions stay mounted when switching tabs

### Changed
- Sidebar: **Search** at top; tools moved to Settings; **Shortcuts** + **Light mode** at bottom

---

## [0.2.2] - 2026-06-03

### Added
- **Light / dark mode** toggle in the sidebar
- **Collapsible sidebar** — full, compact (icons only), or hidden

### Fixed
- **SSH / RDP sessions stuck on Waiting** — tunnel token no longer consumed on reconnect; duplicate session tabs prevented
- Guacamole tunnel forwards client messages during handshake

### Changed
- Removed the global top command bar; Search, Sync, Backup, etc. moved into the sidebar tools section

---

## [0.2.1] - 2026-06-03

### Added
- **Build version badge** in the sidebar and login screen (`v0.2.1 · abc1234`)
- Public **`GET /api/version`** endpoint for verifying the running build
- GitHub **Release** workflow on `v*` tags (creates release + versioned Docker image)

### Fixed
- Form save error (`currentTarget.reset`) on Vault, Inventory, and SSH add-device
- Top command bar layout (oversized Backup/Shortcuts/Sync buttons)
- Page scrolling for long forms (description, notes, vault add panel)
- Vault add form hidden behind **Add credential** button until needed
- Monitoring empty state with link to add checks in Inventory

---

## [0.2.0] - 2026-06-03

### Added

**Reliability & dev experience**
- Auto `DATABASE_URL` bootstrap and schema push on `npm run dev`
- Form error banners and success/error toasts on save actions
- Improved API validation error messages with field details

**Inventory & vault**
- Tabbed Inventory (resource, connection, credential, health check, notes, tags)
- Tag create/assign on resources, connections, and credentials
- Notes linked to resources
- Connection TCP reachability test
- Resource reorder controls
- JSON inventory export (credentials remain encrypted)

**Dashboard & access**
- Connect to SSH/RDP from resource tiles
- Collapsible dashboard groups
- Widget visibility editor
- guacd reachability indicator in Access view
- Session retry on failure
- Keyboard shortcuts help (`?`)

**Monitoring & alerts**
- SSL certificate expiry health checks (warns under 30 days)
- Webhook presets for Discord, Slack, and ntfy
- Public read-only status page at `/status`

### Fixed
- Auth hook now properly stops unauthenticated API requests

---

## [0.1.0] - 2026-06-02

Initial release.

### Added

**Core**
- Dashboard with grouped resource cards, collapsible sections, and configurable widgets
- Health checks: HTTP, TCP, and ping monitors with configurable intervals and failure thresholds
- Incident management: auto-open on check failure, acknowledge, resolve, and mute
- Maintenance windows to suppress incident noise during planned downtime
- Alert channels (webhook, email) with rules, cooldowns, and delivery tracking
- AES-256-GCM credential vault with folder and tag organisation
- Browser-based SSH and RDP sessions via Apache Guacamole `guacd` tunnel
- Session history and audit log
- Freeform notes, pinned and per-resource
- Command palette (Ctrl K / `/`) with global search
- Single-admin cookie-based authentication

**UI**
- Dark theme, responsive sidebar, sticky top bar
- Favorites section on Dashboard showing starred resources
- Explicit Details button on resource tiles (replaces hidden double-click)
- Incident History panel showing all incidents with status badges
- Recent Sessions strip in the Access rail
- Active nav item accent indicator
- Spinning icon on refresh indicator
- Correct icon for Resolve action

**Infrastructure**
- Docker image published to `ghcr.io/kobii-git/homelab-dashboard`
- `SEED_DEMO=true` environment variable loads demo resources, checks, credentials, incidents, and notes on first start
- GitHub Actions workflow builds and pushes image on every push to `main` and on version tags
- `docker-compose.yml` (pull image) and `docker-compose.build.yml` (build locally)
