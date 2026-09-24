# Homelab Dashboard - Handover

This document captures the current state of the project so the next session can continue without rediscovering the shape of the app.

- **Repo:** operator-configured Forgejo SSH remote
- **Images:** `${REGISTRY_HOST}/kobuslabs/homelabdashboard:latest` and `:beta`
- **Current version:** `0.8.0`
- **Port:** `4173`
- **Branch channels:** `main` (stable) and `beta` (pre-release)

---

## What It Is Now

Homelab Dashboard is a private, single-admin, self-hosted browser homepage with Home, Work, and Operations areas. It provides centralized bookmarks and collections, Google search, ordinary ChatGPT links, prompt templates, notes, reading lists, a local focus timer, configurable layouts and weather, portable configuration backups, and shared state with conflict protection. Operations retains service monitoring, Glances host metrics, read-only integrations and API widgets, and its separately configured optional AI briefing. See `docs/BROWSER_HOME.md` and `docs/HOMEPAGE_VALIDATION.md` for setup and validation.

The current product is deliberately not a remote-management platform. SSH, RDP, VNC, Guacamole, credential vaults, session history, incidents, alert delivery, scheduled backups or full-database restore through the UI, tags, script/plugin widgets, AI control agents, mutating arbitrary API calls, and firewall-changing OPNsense actions are out of the active scope.

**Sidebar views:** Dashboard, Services, Admin.

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript (`src/client/`) |
| Backend | Fastify 5 + Zod + TypeScript (`src/server/`) |
| Database | SQLite via Prisma (`prisma/schema.prisma`) |
| Deploy | Docker Compose / Forgejo Container Registry |

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
- `HomepageState`
- `HomepageAsset`

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

Production requires an explicit `SETUP_CODE` when `ADMIN_PASSWORD` is absent and no account
exists. The setup code is never printed to production logs. Remove it after creating the
single database-backed administrator.

Optional env vars:

```yaml
APP_ORIGIN: https://dashboard.home.arpa
OUTBOUND_ALLOWED_CIDRS: 10.0.21.0/24
COOKIE_SECRET: random-32-char-string
SETUP_CODE: ABCDEFGH2345
# ADMIN_PASSWORD: your-password
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

- Dashboard remains one sidebar destination with an accessible Launchpad/Operations segmented switch. Mode and grid/list density are stored per device; new devices default to Launchpad.
- Launchpad leads with greeting/time, compact health, ranked local service search, explicit web-search fallback, favorites, and compact service groups.
- Empty Launchpads show one template-backed onboarding panel instead of empty monitoring sections.
- Optional Open-Meteo weather and GitHub release cards form a narrow desktop utility rail and follow services on mobile.
- Operations keeps the command-center header, monitoring cards, service actions, drag ordering, heartbeats, filters, and detail drawers.
- Unconfigured monitoring surfaces collapse into one **Connect operations data** action.
- Optional AI Command Briefing summarizes sanitized dashboard evidence and suggests read-only next checks.
- Lab Vitals cards show Glances CPU, RAM, disk, network, temperature, container counts, recent trends, and a click-through 24-hour host detail drawer.
- OPNsense cards show API reachability, CPU/RAM/disk, gateway health, interface throughput, firmware version, and a click-through 24-hour integration detail drawer.
- API widget cards show mapped fields from configured read-only JSON APIs.
- Daily Briefing is signal-only: failures, pressure, transitions, stale checks, and threshold activity get detailed cards; quiet periods render one all-clear summary.
- Service cards open saved URLs in a new tab.
- Favorite stars update optimistically.
- Status and latency chips run the service health check.
- URL-backed automatic services get a managed primary HTTP check using the exact URL. Host-only services require an explicit TCP port or confirmed Ping selection; unrelated edits and restarts do not recreate deleted checks.
- Exactly one enabled primary check drives service status, uptime, heartbeat, latency, briefing, AI evidence, and public status. Diagnostic checks retain history without taking the service offline.
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
- Checks are labeled Primary or Diagnostic; promoting a check demotes the previous primary, while disabling/deleting it leaves the service Unknown.
- Unsaved checks can be tested from the dashboard container with strict TLS and the production outbound policy. Ping remains explicit because ICMP can be blocked.
- The Needs review tab flags Ping primaries and automatic services without an enabled primary, but never rewrites them automatically.
- Failure/recovery thresholds gate stable red/green state while every raw sample is still stored in `HealthResult`.

### Admin

- Password change for database-managed admin accounts.
- Launchpad utility configuration for web-search provider, normalized weather location/units, and up to 12 tracked GitHub repositories.
- Known service templates can suggest release repositories; suggestions and manual repositories are only persisted after **Save utilities**.
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
- Production requires exact HTTPS `APP_ORIGIN` and `TRUST_PROXY_CIDRS`; forwarded HTTPS is accepted only from the configured proxy boundary, cookies are Secure, and HSTS is enabled.
- Public unauthenticated routes are limited to login/setup/version/health. Status is disabled by default.
- Sessions are unique signed tokens with a seven-day default expiry. Logout and password change invalidate every browser for the single admin.
- Sensitive target, connector, and destructive changes require a five-minute password reauthentication cookie bound to the active session.
- Browser mutations require matching origin/fetch metadata; trusted CLI requests without browser origin headers remain supported.
- `GET /api/admin/runtime` is authenticated and intentionally avoids secret env values.
- `GET /api/metrics/hosts/:id` is authenticated and returns up to 1,440 recent host samples for the detail drawer.
- `GET /api/integrations/:id` is authenticated and returns up to 1,440 recent integration samples for the detail drawer.
- Dashboard utility configuration is stored as versioned, non-secret JSON in `SystemConfig`; no Prisma model is involved.
- `PATCH /api/settings` accepts partial top-level settings and returns the complete normalized settings object.
- `GET /api/utilities/weather-locations?q=` and `GET /api/utilities/summary` are authenticated. They use only fixed Open-Meteo/GitHub hosts with bounded responses, wall-clock timeouts, and concurrency limits.
- Utility provider calls are isolated from `/api/dashboard`; geocoding is cached for 24 hours, forecasts for 15 minutes, and GitHub releases/repository failures for six hours, with concurrent-request deduplication and stale fallback.
- Utility settings and results contain no credentials and are excluded from public `/status`.
- OPNsense credentials live only in environment variables; SQLite stores source metadata and normalized snapshots, never the API key or secret.
- API widgets only perform read-only JSON requests. Widget secrets are referenced by allowlisted environment variable name, bound to a confirmed origin, and are not stored in SQLite.
- `PUBLIC_STATUS_MODE=disabled|aggregate|services` controls `/status`; disabled is the default and service details require explicit opt-in.
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
- `.forgejo/workflows/docker.yml` typechecks, tests, builds, runs a production startup smoke test, then publishes images to the Forgejo Container Registry on pushes to `main`, `beta`, and `v*` tags. `.github/workflows/docker.yml` mirrors the same branch/tag policy for GitHub compatibility.
- `main` publishes `latest` and `main`; `beta` publishes `beta`; all builds publish an immutable `sha-*` tag and release tags publish semver tags.
- Forgejo Actions must have a Docker-capable runner. The workflow uses the repository token for package publishing.

Release checklist:

```sh
npm run typecheck && npm test && npm run build
git add -A
git commit -m "Release vX.Y.Z"
git push origin main
git push origin beta
```

### Forgejo Branch And Image Policy

`main` is the stable channel and must always exist. `beta` is the pre-release channel and must always exist. Keep both branches synchronized with intentional changes: merge or cherry-pick the tested change into `beta` for early validation, then promote the validated change into `main`. Do not delete either branch. The Compose deployment defaults to `latest`; set `IMAGE_TAG=beta` to deploy the beta image.

---

## Outstanding

- Browser/end-to-end tests are still thin.
- CSS still contains some unused selectors from older UI eras; they are not imported by deleted components, but can be trimmed in a dedicated style cleanup.
- Hyper-V, Docker, and network discovery remain future ideas, not current features.
