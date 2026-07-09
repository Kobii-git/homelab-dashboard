# Homelab Dashboard

A private, self-hosted command center for the services you run at home. It is a LAN/VPN app for launching hosted web services, monitoring lab health, and summarizing useful read-only signals without turning the project into a remote desktop manager.

![Version](https://img.shields.io/badge/version-0.8.0-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Dashboard** - Lab Command Center header, optional AI Command Briefing, Lab Vitals host metrics with host detail drill-downs, expanded Daily Briefing, favorites strip, drag-and-drop card layout, grid/list density toggle, status filters, and an attention strip for anything that is down
- **Heartbeat monitoring** - Uptime-Kuma-style heartbeat bars, uptime %, and latency on every card, plus a detail drawer with a latency sparkline, per-check errors, and threshold-gated stable status
- **Host metrics** - optional Glances endpoints for CPU, RAM, disk, network, temperature, container counts, and recent 24-hour trends
- **OPNsense integration** - optional read-only API polling for firewall status, system pressure, gateways, interfaces, traffic, firmware state, and service import suggestions
- **API widgets** - custom read-only JSON widgets with env-backed secrets, service-based import suggestions, and templates for common homelab apps
- **AI Command Briefing** - optional OpenAI-compatible read-only summaries of sanitized dashboard evidence, cached in SQLite and never exposed on the public status page
- **Real service icons** - auto-resolved from the service name via the [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) CDN, with favicon and letter-avatar fallbacks
- **Command palette** - `⌘K` (or `/`) to search and launch any service or action from anywhere
- **Services** - manual catalog for apps, websites, Docker services, VMs, servers, and other devices, with common homelab templates, duplicate actions, and confirmed OPNsense imports
- **Health checks** - HTTP, TCP, ping, and SSL checks with latest status, latency, failure reason, thresholds, and check history
- **Admin** - password change, Glances host monitors, OPNsense integration status, AI briefing runtime state, API widgets, runtime health diagnostics, public status page, build info, and demo-data controls
- **Status page** - unauthenticated `/status` wallboard with heartbeats and uptime per service

Remote SSH/RDP/VNC access, Guacamole, saved credentials, vaults, alert channels, incidents, script/plugin widgets, backup/restore, tags, notes, AI control agents, and mutating integration actions are intentionally out of the current app scope.

---

## Current Scope

Version `0.8.0` is a focused daily-operations command center with service health, lab vitals, threshold-aware monitoring, optional read-only AI briefings, and safe runtime diagnostics. The app remains designed for one trusted admin on a private LAN, VPN, or private mesh network. It does not include multi-user roles, network discovery, Docker discovery, Hyper-V discovery, or built-in HTTPS termination.

The active database model is intentionally small: `Resource`, `DashboardGroup`, `HealthCheck`, `HealthResult`, `HostMonitor`, `HostMetricSample`, `IntegrationSource`, `IntegrationSample`, `ApiWidget`, `ApiWidgetSample`, `AdminAccount`, and `SystemConfig`.

---

## Quick Start With Docker

### Authenticate To The Private Image Registry

This Forgejo registry is currently served over LAN HTTP. Before `docker login`, add `10.0.21.40:3000` to Docker's insecure registries on each Docker host, then restart Docker:

```json
{
  "insecure-registries": ["10.0.21.40:3000"]
}
```

```sh
echo YOUR_FORGEJO_TOKEN | docker login 10.0.21.40:3000 -u kobus --password-stdin
```

Create a Forgejo access token with package read access. Docker stores the login in `~/.docker/config.json`, so you only need to do this once per machine.

### Install

```sh
curl -fsSL http://10.0.21.40:3000/kobus/homelabdashboard/raw/branch/main/docker-compose.yml \
  -o /tmp/homelab.yml && docker compose -f /tmp/homelab.yml up -d
```

Or pull the image directly:

```sh
docker pull 10.0.21.40:3000/kobus/homelabdashboard:latest
```

Open **http://localhost:4173**. On first visit you will be prompted to create the admin account and optionally load demo data.

### Optional Environment Variables

```yaml
ADMIN_PASSWORD: your-password        # optional; skips web account creation
COOKIE_SECRET: random-32-char-string # optional; persistent sessions across DB resets
OPNSENSE_ENABLED: "true"             # optional; enables read-only firewall polling
OPNSENSE_BASE_URL: https://opnsense.local
OPNSENSE_API_KEY: your-api-key
OPNSENSE_API_SECRET: your-api-secret
AI_ENABLED: "true"                   # optional; enables AI Command Briefing
AI_MODEL: your-model-name
AI_API_KEY: your-ai-api-key
```

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | No | Skip web account creation and use this password instead |
| `COOKIE_SECRET` | No | Signs session cookies; auto-generated if unset |
| `COOKIE_SECURE` | No | Set to `true` only when serving over HTTPS. Default is `false` for plain-HTTP LAN use |
| `DATABASE_URL` | No | Prisma SQLite path; default `file:/data/homelab.db` in Docker |
| `PORT` | No | HTTP port; default `4173` |
| `OPNSENSE_ENABLED` | No | Set to `true` to enable the read-only OPNsense integration |
| `OPNSENSE_NAME` | No | Display name for the firewall; default `OPNsense` |
| `OPNSENSE_BASE_URL` | No | OPNsense web/API base URL, for example `https://opnsense.local` |
| `OPNSENSE_API_KEY` | No | OPNsense API key; stored only in environment |
| `OPNSENSE_API_SECRET` | No | OPNsense API secret; stored only in environment |
| `OPNSENSE_TLS_VERIFY` | No | Set to `false` only for self-signed/private certificates you explicitly trust |
| `OPNSENSE_POLL_INTERVAL_SECONDS` | No | OPNsense polling interval, 15-86400 seconds; default `60` |
| `AI_ENABLED` | No | Set to `true` to enable the authenticated AI Command Briefing |
| `AI_PROVIDER_NAME` | No | Display name for the provider; default `AI` |
| `AI_BASE_URL` | No | OpenAI-compatible API root; default `https://api.openai.com/v1` |
| `AI_API_KEY` | No | Optional provider key; stored only in environment and omitted for local endpoints when unset |
| `AI_MODEL` | Yes, when AI is enabled | Model name sent to the OpenAI-compatible chat completions endpoint |
| `AI_TLS_VERIFY` | No | Set to `false` only for self-signed/private provider certificates you explicitly trust |
| `AI_BRIEFING_INTERVAL_SECONDS` | No | AI briefing cache refresh interval, 300-86400 seconds; default `21600` |
| `AI_INCLUDE_TARGETS` | No | Set to `true` to include service URLs, hosts, and check targets in AI evidence; default redacts them |
| API widget secret vars | No | Optional env vars referenced by widget config, such as `HOME_ASSISTANT_TOKEN` or `SONARR_API_KEY` |

Keep this behind a LAN, VPN, or private mesh network. If exposing it beyond that, put a reverse proxy such as Caddy, nginx, or Traefik in front and enable HTTPS.

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

API widgets are configured in **Admin > API widgets**. Widgets only perform GET JSON reads, never POST/PUT/DELETE actions, and secrets are read from environment variables by name instead of being stored in SQLite. The Admin panel suggests importable widgets when existing service catalog entries look like known apps. Built-in templates currently cover Home Assistant, Proxmox VE, Portainer, AdGuard Home, Pi-hole v6, Jellyfin, Grafana, Prometheus, Sonarr, and Radarr. Apps with non-trivial auth/session protocols, such as TrueNAS SCALE WebSocket APIs or qBittorrent cookie sessions, should become dedicated connectors rather than generic JSON widgets.

---

## Updating

```sh
docker compose pull
docker compose up -d --force-recreate
```

The SQLite database is stored in the named Docker volume `homelab-dashboard-data` and survives updates.

When upgrading from older pro-console or remote-manager builds, startup creates a one-time SQLite backup at `/data/homelab.before-v0.5-schema.db` before applying the simplified schema cleanup.

If a container is stuck restarting, check **Admin > Runtime Health** after it starts, or gather logs from the host:

```sh
docker logs --tail=200 homelab-dashboard
docker compose ps && docker compose logs --tail=200 dashboard
```

---

## Local Development

```sh
git clone ssh://git@10.0.21.40:222/kobus/homelabdashboard.git
cd homelab-dashboard
npm install
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
| `npm run typecheck` | TypeScript type check |
| `npm run db:push` | Apply schema to SQLite |
| `npm run db:studio` | Open Prisma Studio |
| `npm run seed:demo` | Load demo data |

### Build The Docker Image Locally

```sh
docker compose -f docker-compose.build.yml up -d --build
```

To publish multi-architecture images to the LAN HTTP Forgejo registry from a workstation:

```sh
VERSION=$(node -p "require('./package.json').version")
docker buildx create --name forgejo-http --driver docker-container --buildkitd-config .buildkitd-forgejo.toml --use --bootstrap
docker buildx build --builder forgejo-http --platform linux/amd64,linux/arm64 \
  --build-arg APP_GIT_SHA="$(git rev-parse --short=12 HEAD)" \
  --build-arg APP_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "10.0.21.40:3000/kobus/homelabdashboard:${VERSION}" \
  -t 10.0.21.40:3000/kobus/homelabdashboard:latest \
  --push .
```

---

## Stack

| Component | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma ORM |
| Container | Docker / Forgejo package registry |

---

## Versioning

Current: **v0.8.0**

Verify the running build:

```sh
curl -s http://localhost:4173/api/version
```

The sidebar, login screen, `/status` page, and `/api/version` all expose the baked version and git hash.
