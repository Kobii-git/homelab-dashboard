# Homelab Dashboard

A private, self-hosted command center for the services you run at home. It is a LAN/VPN app for launching hosted web services, monitoring lab health, and summarizing useful read-only signals without turning the project into a remote desktop manager.

![Version](https://img.shields.io/badge/version-0.8.0-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Adaptive Dashboard** - device-local Launchpad and Operations presets: Launchpad prioritizes universal search, favorites, and grouped services; Operations keeps the monitoring command center, signal-only briefing, heartbeats, and detail drill-downs
- **Launchpad utilities** - optional Open-Meteo weather and cached GitHub release summaries configured from Admin, plus an explicit web-search fallback with a selectable search provider
- **Heartbeat monitoring** - Uptime-Kuma-style heartbeat bars, uptime %, and latency on every card, plus a detail drawer with a latency sparkline, per-check errors, and threshold-gated stable status
- **Host metrics** - optional Glances endpoints for CPU, RAM, disk, network, temperature, container counts, and recent 24-hour trends
- **OPNsense integration** - optional read-only API polling for firewall status, system pressure, gateways, interfaces, traffic, firmware state, and service import suggestions
- **API widgets** - custom read-only JSON widgets with env-backed secrets, service-based import suggestions, and templates for common homelab apps
- **AI Command Briefing** - optional OpenAI-compatible read-only summaries of sanitized dashboard evidence, cached in SQLite and never exposed on the public status page
- **Private service icons** - fetched through a bounded same-origin proxy from the [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) catalog or approved service favicon, with letter-avatar fallback
- **Command palette** - `⌘K` (or `/`) to search and launch any service or action from anywhere
- **Services** - manual catalog for apps, websites, Docker services, VMs, servers, and other devices, with common homelab templates, duplicate actions, and confirmed OPNsense imports
- **Health checks** - HTTP, TCP, ping, and SSL checks with latest status, latency, failure reason, thresholds, and check history
- **Admin** - password change, Launchpad search/weather/release settings, Glances host monitors, OPNsense integration status, AI briefing runtime state, API widgets, runtime health diagnostics, public status page, build info, and demo-data controls
- **Optional status page** - disabled by default, with aggregate-only or service-detail modes when deliberately enabled

Remote SSH/RDP/VNC access, Guacamole, saved credentials, vaults, alert channels, incidents, script/plugin widgets, backup/restore, tags, notes, AI control agents, and mutating integration actions are intentionally out of the current app scope.

---

## Current Scope

Version `0.8.0` is a focused service launchpad and daily-operations command center with service health, lab vitals, threshold-aware monitoring, optional read-only utilities and AI briefings, and safe runtime diagnostics. The app remains designed for one trusted admin on a private LAN, VPN, or private mesh network. It does not include multi-user roles, network discovery, Docker discovery, Hyper-V discovery, or built-in HTTPS termination.

The active database model is intentionally small: `Resource`, `DashboardGroup`, `HealthCheck`, `HealthResult`, `HostMonitor`, `HostMetricSample`, `IntegrationSource`, `IntegrationSample`, `ApiWidget`, `ApiWidgetSample`, `AdminAccount`, and `SystemConfig`.

---

## Quick Start With Docker

Production deployment requires an existing HTTPS reverse proxy, a TLS-enabled registry, and
an explicit monitoring boundary. Copy `.env.example`, configure the required values, then:

```sh
docker compose pull
docker compose up -d
```

The Compose file binds `127.0.0.1:4173`; open the HTTPS `APP_ORIGIN` through the reverse
proxy. On the first database-backed boot, enter the explicit `SETUP_CODE`, create the
administrator, then remove `SETUP_CODE` from the environment.

Read [Secure Deployment](docs/SECURE_DEPLOYMENT.md) and complete its launch checklist before
using real integration credentials. Backups follow the external
[SQLite Backup and Restore Runbook](docs/BACKUP_AND_RESTORE.md).

| Variable | Required | Description |
|---|---|---|
| `APP_ORIGIN` | Production | Exact externally visible HTTPS origin |
| `TRUST_PROXY_CIDRS` | Production | Exact reverse-proxy source CIDRs trusted for forwarded HTTPS/client information |
| `OUTBOUND_ALLOWED_CIDRS` | Production | Smallest network CIDRs that monitoring may contact |
| `OUTBOUND_ALLOWED_HOSTS` | No | Exact approved public DNS names for admin-defined monitoring |
| `COOKIE_SECRET` | Production | At least 32 random characters; never stored in Git |
| `SETUP_CODE` | First production boot | Explicit 12-character bootstrap code when `ADMIN_PASSWORD` is absent |
| `ADMIN_PASSWORD` | No | Skip web account creation and use this password instead; minimum 12 characters in production |
| `SESSION_MAX_AGE_HOURS` | No | Session lifetime, bounded to 1–720 hours; default `168` |
| `PUBLIC_STATUS_MODE` | No | `disabled`, `aggregate`, or `services`; default `disabled` |
| `ALLOW_INSECURE_INTEGRATIONS` | No | Emergency-only opt-in for HTTP credentials or disabled TLS verification |
| `DATABASE_URL` | No | Prisma SQLite path; default `file:/data/homelab.db` in Docker |
| `NODE_EXTRA_CA_CERTS` | No | In-container path to an operator-mounted private CA PEM bundle |
| `REGISTRY_HOST` | Compose/workflow | Trusted TLS registry hostname without a URL scheme |
| `PORT` | No | HTTP port; default `4173` |
| `OPNSENSE_ENABLED` | No | Set to `true` to enable the read-only OPNsense integration |
| `OPNSENSE_NAME` | No | Display name for the firewall; default `OPNsense` |
| `OPNSENSE_BASE_URL` | No | OPNsense web/API base URL, for example `https://opnsense.local` |
| `OPNSENSE_API_KEY` | No | OPNsense API key; stored only in environment |
| `OPNSENSE_API_SECRET` | No | OPNsense API secret; stored only in environment |
| `OPNSENSE_TLS_VERIFY` | No | Defaults true; install a private CA with `NODE_EXTRA_CA_CERTS` |
| `OPNSENSE_POLL_INTERVAL_SECONDS` | No | OPNsense polling interval, 15-86400 seconds; default `60` |
| `AI_ENABLED` | No | Set to `true` to enable the authenticated AI Command Briefing |
| `AI_PROVIDER_NAME` | No | Display name for the provider; default `AI` |
| `AI_BASE_URL` | No | OpenAI-compatible API root; default `https://api.openai.com/v1` |
| `AI_API_KEY` | No | Optional provider key; stored only in environment and omitted for local endpoints when unset |
| `AI_MODEL` | Yes, when AI is enabled | Model name sent to the OpenAI-compatible chat completions endpoint |
| `AI_TLS_VERIFY` | No | Defaults true; install a private CA with `NODE_EXTRA_CA_CERTS` |
| `AI_BRIEFING_INTERVAL_SECONDS` | No | AI briefing cache refresh interval, 300-86400 seconds; default `21600` |
| `AI_INCLUDE_TARGETS` | No | Set to `true` to include service URLs, hosts, and check targets in AI evidence; default redacts them |
| API widget secret vars | No | Optional env vars referenced by widget config, such as `HOME_ASSISTANT_TOKEN` or `SONARR_API_KEY` |
| `API_WIDGET_SECRET_ALLOWLIST` | No | Comma-separated custom widget secret names. Built-in template secret names are allowed automatically |

Direct internet exposure is unsupported. Keep administration behind the LAN/VPN boundary.

### Optional Host Metrics

Run Glances on a trusted host, then add the endpoint in **Admin > Host metrics**:

```sh
glances -w --disable-webui --bind 0.0.0.0
```

The dashboard expects unauthenticated LAN/VPN Glances endpoints in v1 and does not store Glances credentials.

### Optional OPNsense Integration

Create an OPNsense API key for a least-privileged user with read access to diagnostics, interfaces, routing/gateways, and firmware status. Then set the `OPNSENSE_*` environment variables and restart the dashboard. The integration is read-only in v1: it polls allowlisted API endpoints, stores normalized snapshots/history, shows built-in OPNsense cards, and can suggest service catalog imports that still require admin confirmation.

### Optional AI Command Briefing

Set `AI_ENABLED=true`, `AI_MODEL`, and optionally `AI_API_KEY`/`AI_BASE_URL` for any OpenAI-compatible cloud or local endpoint. The briefing receives sanitized dashboard evidence from services, health checks, Daily Briefing, host monitors, OPNsense snapshots, and API widgets, then caches the latest summary in `SystemConfig`.

By default, service URLs, hosts, IP addresses, and check targets are redacted before they are sent to the provider. Set `AI_INCLUDE_TARGETS=true` only if you want the model to see those details. The AI feature is authenticated admin-only, is not exposed on `/status`, and can only summarize or suggest read-only next checks.

### Optional API Widgets

API widgets are configured in **Admin > API widgets**. Widgets only perform read-only JSON requests, and secrets are read from environment variables by name instead of being stored in SQLite. Each credential is bound to its confirmed normalized origin in non-secret `SystemConfig` metadata, and changing that origin requires recent password confirmation. Only names used by built-in templates or explicitly listed in `API_WIDGET_SECRET_ALLOWLIST` can be attached to requests. Built-in templates currently cover Home Assistant, Proxmox VE, Portainer, AdGuard Home, Pi-hole v6, Jellyfin, Grafana, Prometheus, Sonarr, and Radarr.

### Optional Launchpad Utilities

Configure Launchpad utilities in **Admin > Launchpad utilities**. Web search defaults to DuckDuckGo and can be changed to Google, Brave, Kagi, or Startpage. Weather uses a normalized Open-Meteo location and can display metric or imperial temperatures. Release tracking accepts up to 12 public GitHub repositories in `owner/repository` format; known service templates can suggest repositories, but additions are not persisted until you confirm with **Save utilities**.

Weather and release data are fetched separately from `/api/dashboard`, so provider outages never block service access. Requests use fixed provider hosts, concurrency limits, wall-clock timeouts, and response-size bounds. Location results are cached for 24 hours, forecasts for 15 minutes, and GitHub releases—including repository-level failures—for six hours. Stale cached data is returned when a refresh fails. Utility configuration is non-secret `SystemConfig` JSON and is never included on the public `/status` page.

Enabling weather shares the configured coordinates/timezone with Open-Meteo; enabling releases shares repository identifiers with GitHub. Catalog-icon requests share the selected catalog slug with jsDelivr. API-widget credentials, service metadata, and monitoring targets are not sent to those fixed utility providers.

---

## Updating

```sh
docker compose pull
docker compose up -d --force-recreate
```

Use `IMAGE_TAG=beta docker compose pull` and `IMAGE_TAG=beta docker compose up -d --force-recreate` to run the beta channel. The default channel is `latest`, published from `main`.

The SQLite database is stored in the named Docker volume `homelab-dashboard-data` and survives updates.

Container startup applies the current Prisma schema without `--accept-data-loss`. Back up `/data/homelab.db` before upgrades that include documented destructive migrations.

If a container is stuck restarting, check **Admin > Runtime Health** after it starts, or gather logs from the host:

```sh
docker logs --tail=200 homelab-dashboard
docker compose ps && docker compose logs --tail=200 dashboard
```

---

## Local Development

```sh
git clone ssh://git@forgejo.home.arpa/kobuslabs/homelabdashboard.git
cd homelab-dashboard
npm ci
npm run db:push
npm run dev:all
```

The API runs on `:4173` by default when started alone. In `npm run dev:all`, Vite serves the frontend on `:5173` and proxies API calls to the backend.

Optional demo data:

```sh
DATABASE_URL=file:../data/homelab.db npm run seed:demo
```

### Useful Commands

| Command | Description |
|---|---|
| `npm run dev:all` | Start API and Vite dev server concurrently |
| `npm run clean` | Remove production build output |
| `npm run build` | Production build |
| `npm test` | Run test suite |
| `npm run test:e2e` | Build and run Chromium UI/accessibility tests |
| `npm run typecheck` | TypeScript type check |
| `npm run db:push` | Apply schema to SQLite |
| `npm run db:studio` | Open Prisma Studio |
| `npm run seed:demo` | Load demo data |

### Build The Docker Image Locally

```sh
docker compose -f docker-compose.build.yml up -d --build
```

To publish multi-architecture images to the Forgejo container registry from a workstation:

```sh
VERSION=$(node -p "require('./package.json').version")
test -n "${REGISTRY_HOST}"
docker buildx create --name homelab-builder --driver docker-container --use --bootstrap
docker buildx build --builder homelab-builder --platform linux/amd64,linux/arm64 \
  --build-arg APP_GIT_SHA="$(git rev-parse --short=12 HEAD)" \
  --build-arg APP_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "${REGISTRY_HOST}/kobuslabs/homelabdashboard:${VERSION}" \
  -t "${REGISTRY_HOST}/kobuslabs/homelabdashboard:latest" \
  --push .
```

Log in only to a trusted TLS registry with `docker login "${REGISTRY_HOST}"`. The
`beta` branch publishes the `beta` image; `main` publishes `latest` and `main`.
Every branch build also publishes a short immutable `sha-*` tag and signs the digest.

---

## Stack

| Component | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma ORM |
| Container | Docker / Forgejo Container Registry |

---

## Versioning

Current: **v0.8.0**

Verify the running build:

```sh
curl -s "${APP_ORIGIN}/api/version"
```

Public `/api/version` and the login UI expose only the package version. Authenticated Runtime
Health contains the Git SHA and build time.
