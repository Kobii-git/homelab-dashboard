# Homelab Dashboard Project Memory

## Session Defaults

- Use GPT-5.5 with extra-high reasoning as the default for future Codex work on this project when model choice is available.

## Current Shape

- Homelab Dashboard is a private, single-admin, LAN/VPN/self-hosted service dashboard.
- Treat `package.json` as the source of truth for the app version; docs, badges, lockfiles, tags, and release notes should be checked against it when preparing releases.
- Main scope: service launcher, grouped/favorited services, manual catalog, health checks, heartbeat history, optional Glances host metrics, optional read-only OPNsense integration, custom read-only JSON API widgets, and public read-only status page.
- Explicitly out of scope: SSH/RDP/VNC, Guacamole, credential vaults, multi-user roles, incidents, alerts, script/plugin widgets, backup/restore, network/Docker/Hyper-V discovery, built-in HTTPS termination, mutating arbitrary integration API calls, and firewall-changing OPNsense actions.

## Stack

- Frontend: React 19 + Vite + TypeScript in `src/client`.
- Backend: Fastify 5 + Zod + TypeScript in `src/server`.
- Database: SQLite through Prisma.
- Deploy: Docker/GHCR, app listens on port `4173`.
- Dev: backend `4173`, Vite `5173`, API proxied from Vite to backend.

## Data Model

Active Prisma models only:

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

Do not resurrect old pro-console models for widgets, vaults, sessions, alerts, incidents, tags, notes, audit events, or maintenance windows.

## Auth And Runtime

- Single admin only.
- `ADMIN_PASSWORD` can manage auth from env and skips DB account creation.
- Otherwise first-run setup creates the `AdminAccount`.
- Session cookie is `homelab_session`, signed from `COOKIE_SECRET`.
- `COOKIE_SECURE` defaults false for plain HTTP LAN installs; only set true behind HTTPS.
- Public routes are login/setup/version/health/status-style endpoints; normal API routes require session auth.

## Monitoring

- Check types: `http`, `tcp`, `ping`, `ssl`.
- Health scheduler runs every 15s and executes due enabled checks for resources with `monitoringMode: "auto"`.
- Glances host metrics are optional and stored in `HostMonitor`/`HostMetricSample`.
- OPNsense polling is optional, read-only, env-backed, allowlisted, and stored in `IntegrationSource`/`IntegrationSample`.
- API widgets are optional, read-only JSON GETs with env-var-backed secrets, stored in `ApiWidget`/`ApiWidgetSample`.
- API widget suggestions match existing service catalog entries to built-in templates and create widgets only after admin action.
- Resources support `monitoringMode`: `auto`, `manual`, `disabled`.
- Manual/disabled resources use `manualStatus`; automatic resources derive status from checks.
- Dashboard fetch includes recent health results, used for heartbeat bars, uptime %, and latency sparkline.
- Health result retention is 300 samples per check.
- Host and integration sample retention is 1440 samples per source.
- API widget sample retention is 1440 samples per widget.

## OPNsense

- V1 targets one firewall configured only by env: `OPNSENSE_ENABLED`, `OPNSENSE_NAME`, `OPNSENSE_BASE_URL`, `OPNSENSE_API_KEY`, `OPNSENSE_API_SECRET`, `OPNSENSE_TLS_VERIFY`, `OPNSENSE_POLL_INTERVAL_SECONDS`.
- Credentials must not be stored in SQLite or returned by runtime diagnostics.
- The server may poll only allowlisted read endpoints for diagnostics/system, interfaces, routing/gateways, firmware info/running, and firewall PF/log summary.
- OPNsense import suggestions can create resources only after explicit admin confirmation.

## API Widgets

- Widgets perform read-only JSON polling only; no arbitrary code, POST/PUT/DELETE actions, or secret storage in SQLite.
- Supported auth modes: none, bearer token, custom header, basic auth from `username:password`, and Pi-hole v6 session auth.
- Built-in templates cover Home Assistant, Proxmox VE, Portainer, AdGuard Home, Pi-hole v6, Jellyfin, Grafana, Prometheus, Sonarr, and Radarr.
- Apps with complex session/WebSocket protocols, such as TrueNAS SCALE and qBittorrent, should become dedicated connectors rather than generic widgets.

## UI Shape

- `App.tsx` owns auth/setup/data loading and derives app data from `/api/dashboard`.
- Views are Dashboard, Services, Admin.
- Dashboard is the primary screen: hero, clock, Lab Vitals, OPNsense cards, API widget cards, Daily Briefing, filters, search, favorites strip, attention strip, grid/list density, drag-and-drop card reorder, detail drawers.
- Services is the catalog/editor for groups, resources, health checks, manual status, monitoring mode, and confirmed OPNsense imports.
- Admin handles password, auto ping interval, host metrics, OPNsense integration state, API widgets/import suggestions, sync, runtime diagnostics, and public `/status`.
- Icons use the `homarr-labs/dashboard-icons` CDN, favicon fallback, then initials avatar.
- Styling lives mainly in `src/client/styles/app.css`; dark/light token system, teal accent, compact operational UI.

## Important Commands

- `npm run dev:all`
- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run db:push`
- `npm run seed:demo`

## Tests

- Main tests are in `tests/routes.test.ts`.
- Tests use Vitest node environment, fork pool, and `fileParallelism: false` because SQLite DB access is shared per test run.
- Current coverage focuses on auth protection, setup, groups/resources, health checks, reorder, status uptime/history, manual/disabled monitoring, Glances host metrics, read-only OPNsense integration, and API widgets.

## Drift Checks

- When editing docs/config, check for stale references to old ports, removed Guacamole/vault/remote-access concepts, removed environment variables, and outdated OPNsense env/model lists.
- Keep `README.md`, `HANDOVER.md`, `CONTRIBUTING.md`, `.env.example`, `package-lock.json`, Docker files, and release notes aligned with the current code.
- Keep helper scripts aligned with current function signatures, especially seed/demo entry points.
