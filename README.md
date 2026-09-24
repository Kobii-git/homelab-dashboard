# Homelab Dashboard

A private, self-hosted browser homepage and command center for your bookmarks, work, and home services. Home and Work organize everyday browsing and planning; Operations monitors lab health and useful read-only signals over LAN/VPN.

![Version](https://img.shields.io/badge/version-0.8.0-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Home, Work, and Operations** - shared personal/work layouts, Google-first search, favorites, bookmark collections, scratchpads, reading lists, prompt templates, and a browser-local focus timer; Operations retains the monitoring command center
- **Personal context** - optional read-only Google Calendar agenda, Gmail unread Inbox count, and Todoist overdue/today links with isolated provider failures and stale-cache fallback
- **Calendar dates** - the Launchpad uses the device’s local time for timed events, keeps all-day dates on their intended day, and includes ongoing multi-day events; mail and storage cards flag cached data when providers are unavailable
- **Media and storage** - optional Plex recently-added, Radarr upcoming, TMDB discovery, and TrueNAS capacity/health modules; TrueNAS health also appears in Operations
- **Browser home and bookmarks** - dedicated bookmark management, nested collections, browser HTML import with preview, HTML/JSON export, bulk moves, trash/restore, and cross-device conflict protection; see [Browser home](docs/BROWSER_HOME.md)
- **Homepage utilities** - optional three-day Open-Meteo weather, cached releases, configurable widgets/backgrounds, and normal ChatGPT links using your existing account without new AI API usage
- **Portable configuration** - validated ZIP export/restore with uploaded assets, safety-download confirmation, authentication exclusion, and disabled restored monitoring; see [Backups](docs/BACKUP_AND_RESTORE.md)
- **Private HTTPS option** - pinned Caddy/Cloudflare DNS-01 deployment for LAN/VPN use without public app exposure; see [Private HTTPS](docs/PRIVATE_HTTPS.md)
- **Heartbeat monitoring** - Uptime-Kuma-style heartbeat bars, uptime %, and latency on every card, plus a detail drawer with a latency sparkline, per-check errors, and threshold-gated stable status
- **Host metrics** - optional Glances endpoints for CPU, RAM, disk, network, temperature, container counts, and recent 24-hour trends
- **OPNsense integration** - optional read-only API polling for firewall status, system pressure, gateways, interfaces, traffic, firmware state, and service import suggestions
- **API widgets** - custom read-only JSON widgets with env-backed secrets, service-based import suggestions, and templates for common homelab apps
- **AI Command Briefing** - optional OpenAI-compatible read-only summaries of sanitized dashboard evidence, cached in SQLite and never exposed on the public status page
- **Private service icons** - fetched through a bounded same-origin proxy from the [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) catalog or approved service favicon, with letter-avatar fallback
- **Command palette** - `⌘K` (or `/`) to search and launch any service or action from anywhere
- **Services** - manual catalog for apps, websites, Docker services, VMs, servers, and other devices, with common homelab templates, duplicate actions, and confirmed OPNsense imports
- **Health checks** - one primary HTTP, TCP, ping, or SSL availability check per service, optional non-disruptive diagnostics, in-container testing, latency, failure reasons, thresholds, and history
- **Admin** - password change, Launchpad search/weather/release settings, Glances host monitors, OPNsense integration status, AI briefing runtime state, API widgets, runtime health diagnostics, public status page, build info, and demo-data controls
- **Optional status page** - disabled by default, with aggregate-only or service-detail modes when deliberately enabled

Remote SSH/RDP/VNC access, Guacamole, saved credentials, vaults, alert channels, incidents, script/plugin widgets, scheduled backups or full-database restore through the UI, tags, AI control agents, and mutating integration actions are intentionally out of the current app scope.

---

## Current Scope

Version `0.8.0` is a focused service launchpad and daily-operations command center with service health, lab vitals, threshold-aware monitoring, optional read-only utilities and AI briefings, and safe runtime diagnostics. The app remains designed for one trusted admin on a private LAN, VPN, or private mesh network. It does not include multi-user roles, network discovery, Docker discovery, Hyper-V discovery, or built-in HTTPS termination.

The active database model is intentionally small: `Resource`, `DashboardGroup`, `HealthCheck`, `HealthResult`, `HostMonitor`, `HostMetricSample`, `IntegrationSource`, `IntegrationSample`, `ApiWidget`, `ApiWidgetSample`, `AdminAccount`, and `SystemConfig`.

---

## Quick Start With Docker

Production deployment requires an existing HTTPS reverse proxy on a private LAN/VPN. After
installing Docker with Compose and configuring that proxy, run:

```sh
git clone https://github.com/Kobii-git/homelab-dashboard.git
cd homelab-dashboard
./scripts/install-docker.sh
```

The installer asks for your HTTPS origin, exact proxy source CIDR, and monitoring CIDR. It creates
an owner-readable `.env`, generates `COOKIE_SECRET` and (when needed) `SETUP_CODE`, checks Compose,
and builds the image locally. Keep `.env` private. The Compose file binds `127.0.0.1:4173`; open
`APP_ORIGIN` through the reverse proxy. For first-time setup, read `SETUP_CODE` from `.env`, create
the administrator, then clear `SETUP_CODE`. Later installer runs leave it empty. To prepare
configuration without starting Docker, run `./scripts/install-docker.sh --configure-only`.

If you already copied `.env.example` and saw `COOKIE_SECRET is missing a value`, run the installer
from that checkout. It fills empty secrets without replacing an existing nonempty secret or account.

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
| `HOMELAB_IMAGE` | Compose | GHCR image reference; use a verified digest in production |
| `PORT` | No | HTTP port; default `4173` |
| `OPNSENSE_ENABLED` | No | Set to `true` to enable the read-only OPNsense integration |
| `OPNSENSE_NAME` | No | Display name for the firewall; default `OPNsense` |
| `OPNSENSE_BASE_URL` | No | OPNsense web/API base URL, for example `https://opnsense.local` |
| `OPNSENSE_API_KEY` | No | OPNsense API key; stored only in environment |
| `OPNSENSE_API_SECRET` | No | OPNsense API secret; stored only in environment |
| `OPNSENSE_TLS_VERIFY` | No | Defaults true; install a private CA with `NODE_EXTRA_CA_CERTS` |
| `OPNSENSE_POLL_INTERVAL_SECONDS` | No | OPNsense polling interval, 15-86400 seconds; default `60` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | No | Manually provisioned Google OAuth credentials for Calendar events and Gmail label counts; environment-only |
| `GOOGLE_CALENDAR_IDS` | No | Comma-separated calendar IDs; default `primary` |
| `TODOIST_API_TOKEN` | No | Todoist personal API token; environment-only |
| `TMDB_BEARER_TOKEN` | No | TMDB API read access token; environment-only |
| `TRUENAS_ENABLED` | No | Set to `true` to enable TrueNAS SCALE 25.04+ read-only polling |
| `TRUENAS_BASE_URL`, `TRUENAS_USERNAME`, `TRUENAS_API_KEY` | When TrueNAS is enabled | Credentialed HTTPS origin and read-only JSON-RPC service account |
| `TRUENAS_POOL` | When TrueNAS is enabled | Pool used for operational health |
| `TRUENAS_MEDIA_DATASET` | No | Preferred dataset for Launchpad capacity; pool capacity is used when omitted |
| `TRUENAS_TLS_VERIFY` | No | Defaults true; TrueNAS requires HTTPS/WSS and a trusted certificate |
| `TRUENAS_POLL_INTERVAL_SECONDS` | No | Polling interval, 15-86400 seconds; default `60` |
| `AI_ENABLED` | No | Set to `true` to enable the authenticated AI Command Briefing |
| `AI_PROVIDER_NAME` | No | Display name for the provider; default `AI` |
| `AI_BASE_URL` | No | OpenAI-compatible API root; default `https://api.openai.com/v1` |
| `AI_API_KEY` | No | Optional provider key; stored only in environment and omitted for local endpoints when unset |
| `AI_MODEL` | Yes, when AI is enabled | Model name sent to the OpenAI-compatible chat completions endpoint |
| `AI_TLS_VERIFY` | No | Defaults true; install a private CA with `NODE_EXTRA_CA_CERTS` |
| `AI_BRIEFING_INTERVAL_SECONDS` | No | AI briefing cache refresh interval, 300-86400 seconds; default `21600` |
| `AI_INCLUDE_TARGETS` | No | Set to `true` to include service URLs, hosts, and check targets in AI evidence; default redacts them |
| API widget secret vars | No | Optional env vars referenced by widget config, such as `HOME_ASSISTANT_TOKEN`, `PLEX_TOKEN`, or `RADARR_API_KEY` |
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

### Optional Daily Cockpit

Set the relevant environment variables, restart, and then enable modules in **Admin > Personal context**. Google access is manually provisioned—there is no in-app OAuth or token vault. Calendar requests use `calendar.events.readonly`; Gmail reads only the Inbox label count and never fetches subjects, senders, snippets, or bodies. Todoist returns at most six overdue/today tasks and only links to the service.

For media, add a Plex API widget using the built-in Plex template and `PLEX_TOKEN`, and optionally a Radarr widget using `RADARR_API_KEY`; select those widgets in the daily cockpit settings. TMDB supplies upcoming/trending discovery for the configured region and language. Each provider is cached independently, and provider failure does not block `/api/dashboard` or service launch.

For storage, configure a least-privileged TrueNAS SCALE 25.04+ service account with `pool.query` and `pool.dataset.query` access. The dashboard uses bounded WSS JSON-RPC, retains 1,440 normalized samples, warns at 80%, marks 90% critical, and never exposes the API key. Only TrueNAS operational samples are persisted; calendar, tasks, mail, and media results stay in memory.

### Service Health Monitoring

Each automatically monitored service has one **Primary** check that controls its badge, uptime,
heartbeat, latency, Daily Briefing entry, and public status. Additional **Diagnostic** checks retain
their own results but cannot mark the service offline. Promote a different enabled check from
**Services > Checks**; disabling or deleting the primary intentionally leaves the service Unknown.

A saved service URL creates a managed HTTP check using its exact scheme, port, path, and query.
Host-only services require an explicit TCP port or an explicit Ping choice—ICMP is never assumed.
Use **Test from dashboard** to test DNS, outbound policy, transport, TLS, and response handling from
inside the deployed container before saving a check. HTTP redirects and authentication responses
below 500 count as reachable; 5xx responses and connection failures do not.

TLS verification is always strict for health checks. For private/self-signed web interfaces such as
OPNsense, either install the private CA with `NODE_EXTRA_CA_CERTS` or use a primary TCP check for the
HTTPS port and keep certificate inspection diagnostic. **Services > Needs review** identifies
existing Ping primaries and automatic services without an enabled primary; it never changes them
without administrator action.

### Optional AI Command Briefing

Set `AI_ENABLED=true`, `AI_MODEL`, and optionally `AI_API_KEY`/`AI_BASE_URL` for any OpenAI-compatible cloud or local endpoint. The briefing receives sanitized dashboard evidence from services, health checks, Daily Briefing, host monitors, OPNsense snapshots, and API widgets, then caches the latest summary in `SystemConfig`. Personal context, media data, and TrueNAS storage snapshots are deliberately excluded from AI evidence.

By default, service URLs, hosts, IP addresses, and check targets are redacted before they are sent to the provider. Set `AI_INCLUDE_TARGETS=true` only if you want the model to see those details. The AI feature is authenticated admin-only, is not exposed on `/status`, and can only summarize or suggest read-only next checks.

### Optional API Widgets

API widgets are configured in **Admin > API widgets**. Widgets only perform read-only JSON requests, and secrets are read from environment variables by name instead of being stored in SQLite. Each credential is bound to its confirmed normalized origin in non-secret `SystemConfig` metadata, and changing that origin requires recent password confirmation. Only names used by built-in templates or explicitly listed in `API_WIDGET_SECRET_ALLOWLIST` can be attached to requests. Built-in templates currently cover Home Assistant, Proxmox VE, Portainer, AdGuard Home, Pi-hole v6, Jellyfin, Grafana, Prometheus, Sonarr, Radarr, and Plex.

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

Set `HOMELAB_IMAGE=ghcr.io/kobii-git/homelab-dashboard:beta` before pulling and recreating the service to run the beta channel; only use it after a successful beta publication. The default channel is `latest`, published from `main`.

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
git clone https://github.com/Kobii-git/homelab-dashboard.git
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
./scripts/install-docker.sh
```

The build override inherits the root Compose file's loopback binding, HTTPS-proxy boundary,
storage and container hardening. It does not publish an image.

To publish multi-architecture images to the GitHub Container Registry from a workstation:

```sh
VERSION=$(node -p "require('./package.json').version")
docker login ghcr.io
docker buildx create --name homelab-builder --driver docker-container --use --bootstrap
docker buildx build --builder homelab-builder --platform linux/amd64,linux/arm64 \
  --build-arg APP_GIT_SHA="$(git rev-parse --short=12 HEAD)" \
  --build-arg APP_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "ghcr.io/kobii-git/homelab-dashboard:${VERSION}" \
  -t "ghcr.io/kobii-git/homelab-dashboard:latest" \
  --push .
```

See [GitHub operations](GITHUB.md) for private image access and signature verification. The
`beta` branch publishes the `beta` image; `main` publishes `latest` and `main`.
Every branch build also publishes a short immutable `sha-*` tag and signs the digest.

---

## Stack

| Component | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma ORM |
| Container | Docker / GitHub Container Registry |

---

## Versioning

Current: **v0.8.0**

Verify the running build:

```sh
curl -s "${APP_ORIGIN}/api/version"
```

Public `/api/version` and the login UI expose only the package version. Authenticated Runtime
Health contains the Git SHA and build time.
