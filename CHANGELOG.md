# Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
