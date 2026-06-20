# Homelab Dashboard - Handover

This document captures the current state of the project so the next session can continue without rediscovering the shape of the app.

- **Repo:** https://github.com/Kobii-git/homelab-dashboard
- **Image:** `ghcr.io/kobii-git/homelab-dashboard`
- **Current version:** `0.7.2`
- **Port:** `4173`
- **Current branch:** `main`

---

## What It Is Now

Homelab Dashboard is a private, single-admin, self-hosted service launcher, health dashboard, and lab-vitals console. It is focused on manually managed hosted services and optional Glances host monitors.

The current product is deliberately not a remote-management platform. SSH, RDP, VNC, Guacamole, credential vaults, session history, incidents, alert delivery, backup/restore, tags, notes, and dashboard widgets were removed from the active scope.

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
- `AdminAccount`
- `SystemConfig`

Schema cleanup in `0.5.0` removes old pro-console models: widgets, layout, tags, notes, incidents, maintenance windows, alert channels/rules/deliveries, and audit events.

---

## Deploy And Run

### Pull The Prebuilt Image

The image is private, so authenticate once on the Docker host:

```sh
echo <GH_PAT_with_read:packages> | docker login ghcr.io -u Kobii-git --password-stdin
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

On startup, Docker creates `/data/homelab.before-v0.5-schema.db` once before Prisma applies the simplified schema with `--accept-data-loss`. That backup is specifically for users upgrading from the older V2/pro-console shape.

### First Run

On first visit, the setup screen creates the single admin account and optionally loads demo services and health checks.

Optional env vars:

```yaml
ADMIN_PASSWORD: your-password
COOKIE_SECRET: random-32-char-string
```

Optional host metrics use trusted LAN/VPN Glances endpoints:

```sh
glances -w --disable-webui --bind 0.0.0.0
```

---

## Feature State

### Dashboard

- Operations header with overall service and host status.
- Lab Vitals cards show Glances CPU, RAM, disk, network, temperature, container counts, and recent trends.
- Daily Briefing summarizes offline services, recent transitions, host pressure, stale checks, and unmonitored automatic services.
- Service cards open saved URLs in a new tab.
- Favorite stars update optimistically.
- Status and latency chips run the service health check.
- If a service has no health check, the dashboard creates a default HTTP or ping check from its URL or host.
- Filters: all, favorites, online, offline, unknown.
- Group sections can be collapsed.

### Services

- Manual catalog for service resources and groups.
- Add/edit/delete resources.
- Add/edit/delete health checks.
- Reorder resources.
- Health check types: `http`, `tcp`, `ping`, `ssl`.

### Admin

- Password change for database-managed admin accounts.
- Host monitor management for unauthenticated LAN/VPN Glances endpoints.
- Theme toggle.
- Public `/status` page link and build/version information.
- Setup can be dismissed and demo data can be loaded.

---

## Auth And Runtime Notes

- Single admin only.
- `ADMIN_PASSWORD` env var still works and bypasses web account creation.
- Otherwise an `AdminAccount` row stores the admin username and password hash.
- `COOKIE_SECURE=false` by default because the target deployment is plain HTTP on a private LAN. Set it to `true` only behind HTTPS.
- Public unauthenticated routes are limited to login/setup/version/health/status style endpoints.
- Protected API routes require the session cookie.

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

---

## Versioning And Release

- Version lives in `package.json`.
- `src/shared/version.ts` reads the package version and exposes it through the UI and `/api/version`.
- `.github/workflows/docker.yml` publishes Docker images to GHCR on pushes to `main` and on `v*` tags.
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
