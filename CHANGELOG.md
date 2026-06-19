# Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.0] - 2026-06-20

### Added
- Glances-based host monitors with CPU, RAM, disk, network, temperature, and
  container metrics.
- Lab Vitals dashboard cards with recent resource history and pressure states.
- Daily Briefing for offline services, recent status changes, host pressure,
  stale checks, and unmonitored automatic services.
- Admin host monitor management with test connection, pause/resume, and delete.

### Changed
- Dashboard first screen now uses an operations header and richer resource
  palette while keeping the existing service launcher workflow.
- Version and setup docs now describe the v0.7 metrics release.

## [0.6.1] - 2026-06-20

### Fixed
- Automatic service checks now follow updated service URLs/hosts, reset stale
  failure state after target changes, and repair stale auto-created check
  targets on startup.
- Stale in-flight health check results are ignored if the check target or
  monitoring mode changed while the probe was running.
- Dashboard status, heartbeat, uptime, latency, and error summaries now ignore
  disabled checks, matching the public status API.

## [0.6.0] - 2026-06-12

A full dashboard revamp inspired by the best of Homarr, Homepage, Glance, and
Uptime Kuma.

### Added
- **Real service icons**: icons auto-resolve from the service name via the
  `homarr-labs/dashboard-icons` CDN, with favicon and letter-avatar fallbacks.
  The icon field now accepts a slug (`plex`, `home-assistant`) or an image URL.
- **Heartbeat bars** (Uptime-Kuma style): every card shows the recent check
  history as colored ticks with per-tick tooltips.
- **Uptime %** per service, computed from stored check history, shown on cards,
  in the detail drawer, and on the public status page.
- **Service detail drawer**: uptime/latency/last-checked stats, a large
  heartbeat, an SVG latency sparkline, the check list with errors, and quick
  actions (open, check now, edit, favorite).
- **Command palette** (`⌘K` / `/`): fuzzy-search services and actions, arrow
  keys + Enter to launch.
- **Drag-and-drop reordering** of service cards within a group, persisted via
  the new `POST /api/resources/reorder` endpoint.
- **Dashboard hero**: greeting with username, live clock, date, and an
  at-a-glance online/offline/unknown summary.
- **Attention strip** listing offline services with their latest error; click
  to open the detail drawer.
- **Favorites strip** of one-click launch tiles.
- **Grid/list density toggle**, persisted locally.
- Tab title shows `(N down)` when services are offline; data refreshes on
  window focus.
- Public status page redesigned with heartbeat ticks, uptime, and latency.
- Browser favicon.

### Changed
- Dashboard payload now includes recent health results per check (last 60).
- Health result retention raised from 100 to 300 samples per check.
- Sidebar: brand mark, search/palette button, theme toggle and log out moved
  into the footer (the floating log-out button is gone), proper Admin icon.
- Login and setup screens restyled with ambient gradients.
- Demo seed now includes icon slugs and generated check history so heartbeats,
  uptime, and the latency sparkline are visible immediately.
- Filter chips show per-status counts; group headers show online ratios.
- Stylesheet rewritten: dead styles from removed features purged, new design
  tokens, pulse/slide animations, light/dark refinements.

### Fixed
- `npm run dev` now pins the API to port 4173 (override with `API_PORT`) so it
  cannot collide with the Vite dev server port.

## [0.5.2] - 2026-06-10

### Added
- Service-level monitoring mode: automatic, manual status, or disabled.
- Manual online/offline/unknown status override for services.
- Inline monitoring controls on the Services catalog.

### Fixed
- Logout button now has stable compact sizing across sidebar modes.
- Public `/status` now respects manual/disabled service status instead of only
  counting raw health-check rows.

## [0.5.0] - 2026-06-10

### Changed
- Completed the simplification into a focused service dashboard: active scope is
  Dashboard, Services, Admin, resources, groups, and health checks.
- Reduced the Prisma schema to the active models only: resources, groups, checks,
  check history, admin account, and system config.
- Docker startup now creates `/data/homelab.before-v0.5-schema.db` once before
  applying the simplified schema cleanup.
- README and HANDOVER now describe the actual simplified app instead of the old
  V2 pro-console.

### Removed
- Removed stale database models and active references for widgets, tags, notes,
  incidents, maintenance windows, alerts, audit events, vault keys, and old
  Guacamole reachability helpers.

### Fixed
- Fixed TypeScript/build breakage from stale `V2Data` imports and incomplete
  health-check DTOs.
- Restored the shared API error helper used by form actions.
- Fixed the public `/status` page JavaScript summary pill rendering.

## [0.4.4] - 2026-06-10

### Changed
- Dashboard service cards now let you click status/latency to run a health check.
  If a service has no checks yet, the dashboard creates a sensible default check
  from its URL or host and runs it immediately.
- Favorite stars now update optimistically and render as visibly selected.

## [0.4.3] - 2026-06-10

### Fixed
- Docker startup now exports `RUST_LOG=debug` before running Prisma `db push`.
  This avoids the blank Prisma schema-engine crash that caused the container to
  restart before the web app could load on Docker hosts.

## [0.4.2] - 2026-06-10

### Changed
- Simplified the dashboard landing view by removing the oversized `Homelab launchpad`
  hero/card and replacing it with a compact metric strip.

### Fixed
- Tightened the dashboard signal panel density so the page is less vertically bulky.

## [0.4.1] - 2026-06-10

### Fixed
- Docker startup now creates a one-time SQLite backup at
  `/data/homelab.before-v0.4-schema.db` before applying schema changes.
- Docker startup now allows the intentional schema cleanup required when
  upgrading older installs that still contain removed SSH/RDP/Vault tables.

---

## [0.4.0] - 2026-06-10

### Changed
- Reworked the home dashboard into a service-first homelab launchpad with
  launchable service cards, status filters, health mix, response-time bars,
  active incident summary, and lower-priority pinned notes.
- Renamed the user-facing Inventory area to **Services** and made it a compact
  catalog: add/edit forms now open only when requested instead of being expanded
  by default.
- Moved theme switching and keyboard shortcuts out of the sidebar and into
  Admin.
- Updated command palette/navigation copy around services rather than inventory.
- Moved the active Services frontend module out of the old `features/inventory`
  path and into `features/services`.
- Tightened the left sidebar density and renamed the visible Settings area to
  Admin.

### Removed
- Removed remaining recent-session/remote-facing UI traces from the dashboard
  surface, including unused session tab primitives and access/session CSS.

### Fixed
- Backend-only source runs no longer serve raw Vite/TSX files as the browser app;
  the server only serves the built client bundle when static assets exist.

---

## [0.3.0] - 2026-06-10

### Removed
- **Breaking:** removed the SSH/RDP/VNC remote-access manager, Guacamole tunnel,
  remote session UI, and user credential vault from the current app scope.

### Fixed
- First-run setup now works for env-managed or existing-admin installs after the
  admin logs in, instead of dead-ending on the setup screen.
- Default dashboard widget seeding no longer creates removed `recentSessions` or
  `vaultHealth` widgets.
- Backup/restore UI copy now describes encrypted alert configs rather than the
  removed credential vault.

### Changed
- README and HANDOVER now document the current monitoring/inventory dashboard
  instead of the previous remote-manager build.
- Removed unused Guacamole environment/test fields from the active runtime shape.
- Upgraded `@fastify/static` to `^9.1.3`.

---

## [0.2.15] - 2026-06-03

### Changed
- **Design system (Phase 1)** — formal spacing, typography, radii, semantic color,
  elevation, motion, and focus-ring tokens in `app.css` with full light/dark parity.
- **Component primitives (Phase 2)** — shared `PageHeader`, `SectionHeader`, buttons,
  fields, status pills, `MetricCard`, `EmptyPanel`, `TabChip`, and `InlineSpinner`.
- **App shell (Phase 3)** — sidebar nav at 40px with accent active bar, tabular stat
  chips, unified page headers across every view, consistent page padding rhythm.
- **Dashboard** — renamed "Pro Console" to **Dashboard**; widget cards with top-aligned
  titles, compact empty states, equal-height service status metric grid.
- **Remote** — single-row fixed-height session tab chips (truncate + hover close);
  toolbar and device rail density aligned to design tokens.
- **Vault** — audit log as aligned three-column table; detail panel rhythm tightened.
- **Inventory** — dense two-column forms; tab pills and field styling unified.
- **Monitoring / Alerts / Settings** — `PageHeader`, metric rows, segmented filters,
  and form layouts brought in line with the design system.
- **Login / Setup** — polished card spacing, focus rings, loading spinner on submit.
- **Interaction (Phase 5)** — secondary vs primary button distinction, hover/active
  transitions, toast styling, syncing indicator, reduced-motion honored.
- **Accessibility (Phase 6)** — `:focus-visible` rings on all interactive elements,
  semantic status colors app-wide, responsive reflow for forms/tabs/sidebar.

---

## [0.2.14] - 2026-06-05

### Fixed
- **Browser freeze with multiple sessions** — only the active tab runs a Guacamole
  client now; background tabs disconnect instead of all rendering RDP at once.
- **RDP performance** — disabled wallpaper, theming, composition, and animations;
  capped resolution at 1920×1080 and reduced color depth to 16-bit.
- **RDP blue / blank screen** — centered scaled canvas and separated RDP vs SSH
  display layout so the desktop renders correctly.
- **SSH terminal layout** — terminal now fills the panel at native scale instead
  of shrinking into a corner with empty black space.

---

## [0.2.13] - 2026-06-05

### Added
- **Unified Remote console** — SSH and RDP combined into one **Remote** view with a
  Devolutions-style device rail on the left and session tabs on the right.
- **Device rail** — compact, scrollable list grouped by protocol and folder; click
  to connect or switch tabs; collapse to icon strip for more session space.
- **Collapsible history panel** — session history tucked behind a toggle instead of
  always consuming vertical space.

### Changed
- Sidebar navigation replaces separate **SSH** and **Remote Desktop** entries with
  a single **Remote** item.
- Remote sessions share one tab bar across SSH and RDP connections.
- Fullscreen mode keeps the device rail accessible and fixes scroll/layout issues
  in the session area.

---

## [0.2.12] - 2026-06-04

### Added
- **Configurable dashboard widget grid.** The dashboard now renders from saved
  `DashboardWidget` records instead of a hardcoded partial set.
- **Widget controls.** `Customize widgets` can show/hide widgets, move them
  up/down, and cycle compact/medium/wide/full-width layouts.
- **Service Status, Favorite Launchers, Vault Health, and Pinned Notes widgets**
  now participate in the configurable dashboard grid.

### Fixed
- Default widget seeding now backfills missing widget types on existing installs.
- Demo data now updates widgets by type to avoid duplicate cards when defaults
  already exist.
- Dashboard and widget settings defensively render one widget per type if an
  older local database already contains duplicates.

### Verified
- `npm run typecheck`
- `npm test` — 23 tests across 7 files
- `npm run build`
- Browser smoke test on the local dashboard with demo data and widget settings.

---

## [0.2.11] - 2026-06-04

### Added
- **HANDOVER.md** — a full handover document: architecture, deployment, the
  Guacamole tunnel gotchas (the four bugs that made SSH/RDP "never work"), auth
  & secrets, testing, the release process, known limitations, and next steps.
  Linked from the README.

---

## [0.2.10] - 2026-06-04

### Added
- **Paste / send text to a session.** A clipboard button in the session toolbar opens a box where you can paste or type text that is then "typed" into the remote as keystrokes — works for SSH terminals and RDP fields, and crucially works over plain HTTP (where the browser clipboard API is blocked). Cmd/Ctrl+Enter sends, Esc closes.
- **Ctrl+Alt+Del** button for RDP sessions.
- **Best-effort clipboard sync** (remote → local) when served over HTTPS/localhost; a harmless no-op over plain HTTP.

### Notes
- Character→keysym mapping (including non-Latin Unicode and surrogate-pair emoji) is covered by unit tests.

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
