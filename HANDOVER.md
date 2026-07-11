# Homelab Dashboard - Handover

This document captures the current state of the project so the next session can continue without rediscovering the shape of the app.

- **Repo:** https://github.com/kobus/homelabdashboard
- **Image:** `ghcr.io/kobus/homelabdashboard`
- **Current version:** `0.8.0`
- **Port:** `4173`
- **Current branch:** `main`

---

## What It Is Now

Homelab Dashboard is a private, single-admin, self-hosted service launcher and lab command center with health monitoring, lab-vitals cards, read-only OPNsense status, custom API widgets, and optional AI command briefings. It is focused on manually managed hosted services, optional Glances host monitors, optional env-backed OPNsense API polling, read-only JSON API widgets, and sanitized read-only AI summaries.

The current product is deliberately not a remote-management platform. SSH, RDP, VNC, Guacamole, credential vaults, session history, incidents, alert delivery, backup/restore, tags, notes, script/plugin widgets, AI control agents, mutating arbitrary API calls, and firewall-changing OPNsense actions are out of the active scope.

**Sidebar views:** Dashboard, Services, Admin.

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript (`src/client/`) |
| Backend | Fastify 5 + Zod + TypeScript (`src/server/`) |
| Database | SQLite via Prisma (`prisma/schema.prisma`) |
| Deploy | Docker Compose / GHCR |

---

## Current Data Model

The active Prisma models are:

- `Resource`
- `DashboardGroup`
- `HealthCheck`
- `HealthResult`
- `HostMonitor`
- `HostMetricSample`
- `IntegrationSource`
- `IntegrationSample`
- `ApiWidget`
- `ApiWidgetSample`
- `AdminAccount`
- `SystemConfig`

Schema cleanup in `0.5.0` removes old pro-console models: widgets, layout, tags, notes, incidents, maintenance windows, alert channels/rules/deliveries, and audit events.

---

## Deploy And Run

### Pull The Prebuilt Image

```sh
docker compose pull
docker compose up -d --force-recreate
```

### Build From Source On The Docker Host

```sh
cd ~/homelab-dashboard
git pull --ff-only origin main
docker compose -f docker-compose.build.yml up -d --build --force-recreate
```

Data lives in the named Docker volume `homelab-dashboard-data`. It survives container removal, image updates, and rebuilds. It is only destroyed by `docker compose down -v` or deleting the volume.

The image runs as the unprivileged `node` user. Compose drops Linux capabilities, enables `no-new-privileges`, uses a read-only root filesystem, and keeps SQLite writable only under `/data`.

### First Run

Without `ADMIN_PASSWORD`, startup prints a new 12-character one-time setup code. The setup screen requires that code and a 12–256 character password before creating the single admin account.

Optional env vars:

```yaml
ADMIN_PASSWORD: your-password
COOKIE_SECRET: random-32-char-string
```

Optional host metrics use trusted LAN/VPN Glances endpoints:

```sh
glances -w --disable-webui --bind 0.0.0.0
```

Optional read-only OPNsense polling is configured only from env:

```yaml
OPNSENSE_ENABLED: "true"
OPNSENSE_NAME: OPNsense
OPNSENSE_BASE_URL: https://opnsense.local
OPNSENSE_API_KEY: your-api-key
OPNSENSE_API_SECRET: your-api-secret
OPNSENSE_TLS_VERIFY: "true"
OPNSENSE_POLL_INTERVAL_SECONDS: "60"
```

Optional AI command briefings are configured only from env:

```yaml
AI_ENABLED: "true"
AI_PROVIDER_NAME: AI
AI_BASE_URL: https://api.openai.com/v1
AI_API_KEY: your-api-key
AI_MODEL: your-model
AI_TLS_VERIFY: "true"
AI_BRIEFING_INTERVAL_SECONDS: "21600"
AI_INCLUDE_TARGETS: "false"
```

API widgets may use built-in template secret names. Custom names must also be listed in `API_WIDGET_SECRET_ALLOWLIST`:

```yaml
HOME_ASSISTANT_TOKEN: long-lived-token
PROXMOX_API_TOKEN: user@pam!token=secret
ADGUARD_BASIC_AUTH: username:password
PIHOLE_PASSWORD: password
SONARR_API_KEY: api-key
RADARR_API_KEY: api-key
API_WIDGET_SECRET_ALLOWLIST: MY_CUSTOM_WIDGET_TOKEN
```

---

## Feature State

### Dashboard

- Operations header with overall service and host status.
- Optional AI Command Briefing summarizes sanitized dashboard evidence and suggests read-only next checks.
- Lab Vitals cards show Glances CPU, RAM, disk, network, temperature, container counts, recent trends, and a click-through 24-hour host detail drawer.
- OPNsense cards show API reachability, CPU/RAM/disk, gateway health, interface throughput, firmware version, and a click-through 24-hour integration detail drawer.
- API widget cards show mapped fields from configured read-only JSON APIs.
- Daily Briefing summarizes online/offline counts, threshold watchlist items, recent transitions, host pressure, stale checks, and unmonitored automatic services.
- Service cards open saved URLs in a new tab.
- Favorite stars update optimistically.
- Status and latency chips run the service health check.
- A managed default check is created only with a new automatic service or an explicit transition to automatic monitoring. Paused or deleted defaults remain paused or deleted.
- Filters: all, favorites, online, offline, unknown.
- Group sections can be collapsed.

### Services

- Manual catalog for service resources and groups.
- Add/edit/delete resources.
- Common service templates can prefill new service forms.
- OPNsense import suggestions can create firewall/gateway/interface resources only after admin confirmation.
- Duplicate action copies a service's launcher/catalog fields.
- Add/edit/delete health checks.
- Reorder resources.
- Health check types: `http`, `tcp`, `ping`, `ssl`.
- Failure/recovery thresholds gate stable red/green state while every raw sample is still stored in `HealthResult`.

### Admin

- Password change for database-managed admin accounts.
- Host monitor management for unauthenticated LAN/VPN Glances endpoints.
- OPNsense env/config status, latest sample state, manual read-only poll action, and integration scheduler diagnostics.
- AI briefing env/config status, cache state, manual run action, and scheduler diagnostics.
- API widget management with service-based import suggestions, templates, env-var-backed secrets, field mappings, manual test, pause/resume, and delete.
- Runtime Health panel shows build info, process uptime, safe DB counts, scheduler state, and copyable Docker log commands.
- Theme toggle.
- Public `/status` page link and build/version information.
- Setup can be dismissed and demo data can be loaded.

---

## Auth And Runtime Notes

- Single admin only.
- `ADMIN_PASSWORD` bypasses web account creation. Otherwise startup requires the one-time setup code.
- Otherwise an `AdminAccount` row stores the admin username and password hash.
- `COOKIE_SECURE=false` by default because the target deployment is plain HTTP on a private LAN. Set it to `true` only behind HTTPS.
- Public unauthenticated routes are limited to login/setup/version/health/status style endpoints.
- Sessions are unique signed tokens with a 30-day server-enforced expiry. Logout and password change invalidate every browser for the single admin.
- Browser mutations require matching origin/fetch metadata; trusted CLI requests without browser origin headers remain supported.
- `GET /api/admin/runtime` is authenticated and intentionally avoids secret env values.
- `GET /api/metrics/hosts/:id` is authenticated and returns up to 1,440 recent host samples for the detail drawer.
- `GET /api/integrations/:id` is authenticated and returns up to 1,440 recent integration samples for the detail drawer.
- OPNsense credentials live only in environment variables; SQLite stores source metadata and normalized snapshots, never the API key or secret.
- API widgets only perform read-only JSON requests. Widget secrets are referenced by allowlisted environment variable name and are not stored in SQLite.
- Public `/api/status` resources contain only name, status, uptime percentage, and heartbeat ticks; URLs, hosts, targets, errors, IDs, and latency stay private.
- AI provider settings are env-backed. `AI_API_KEY` is never stored in SQLite or returned by runtime diagnostics.
- AI Command Briefing uses sanitized dashboard evidence, redacts service URLs/IPs/check targets by default, caches only the latest briefing in `SystemConfig`, and is never exposed on the public `/status` page.
- Built-in API widget templates cover Home Assistant, Proxmox VE, Portainer, AdGuard Home, Pi-hole v6, Jellyfin, Grafana, Prometheus, Sonarr, and Radarr; `/api/api-widget-suggestions` matches existing service catalog entries to those templates.

---

## What Codex Changed In 0.8.0

- Implemented threshold-gated stable health status while preserving every raw health result.
- Expanded Daily Briefing with summary counters and threshold watchlist entries.
- Added Lab Vitals host detail drawer and authenticated host-detail API.
- Added read-only OPNsense integration models, env config, scheduler, dashboard cards, Admin status, and Services import suggestions.
- Added API widget models, templates, service-based import suggestions, scheduler, Dashboard cards, Admin management, and env-backed secret handling.
- Added optional env-backed AI Command Briefing with sanitized evidence, cached output, Dashboard panel, Admin runtime status, and scheduler diagnostics.
- Added Services templates and duplicate-service action.
- Added Admin Runtime Health diagnostics and production startup smoke coverage.
- Build now cleans `dist` before compiling.

---

## What Codex Changed In 0.5.0

- Fixed TypeScript/build breakage after the simplification pass.
- Restored the shared API error helper used by form actions.
- Corrected dashboard/service data types so health checks include resource ID, interval, timeout, thresholds, counters, and transition metadata.
- Typed default health-check creation from the dashboard.
- Fixed the generated `/status` page JavaScript string.
- Removed stale Prisma models and relations for widgets, tags, notes, incidents, alerts, audit events, and maintenance windows.
- Removed the stale Guacamole reachability helper and dead incident module.
- Updated Docker startup backup naming to `/data/homelab.before-v0.5-schema.db`.
- Removed `HOMELAB_VAULT_KEY` from docs, compose comments, and test script.
- Updated README and this handover to describe the actual simplified dashboard.

---

## Local Development

```sh
npm install
npm run db:push
npm run dev:all
```

Useful commands:

```sh
npm run typecheck
npm test
npm run build
```

The test script creates a timestamped SQLite database under `data/` and runs Vitest sequentially (`fileParallelism: false` in `vitest.config.ts`) to avoid cross-test SQLite contention.

`npm run build` runs `npm run clean` first so stale compiled files from removed routes cannot linger in `dist`.

---

## Versioning And Release

- Version lives in `package.json`.
- `src/shared/version.ts` reads the package version and exposes it through the UI and `/api/version`.
- `.github/workflows/docker.yml` typechecks, tests, builds, runs a production startup smoke test, then publishes Docker images to GHCR on pushes to `main` and on `v*` tags.
- Tag pushes publish semver image tags. The workflow does not currently create a GitHub Release page.

Release checklist:

```sh
npm run typecheck && npm test && npm run build
git add -A
git commit -m "Release vX.Y.Z"
git push origin main
```

---

## Outstanding

- Browser/end-to-end tests are still thin.
- CSS still contains some unused selectors from older UI eras; they are not imported by deleted components, but can be trimmed in a dedicated style cleanup.
- Hyper-V, Docker, and network discovery remain future ideas, not current features.
