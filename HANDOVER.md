# Homelab Dashboard - Handover

This document captures the current state of the project so the next session can
continue without rediscovering the shape of the app.

- **Repo:** https://github.com/Kobii-git/homelab-dashboard
- **Image:** `ghcr.io/kobii-git/homelab-dashboard`
- **Current version:** `0.4.0`
- **Port:** `4173`
- **Current branch:** `main`

---

## 1. What It Is Now

Homelab Dashboard is a private, single-admin, self-hosted service launchpad and
status dashboard. It is currently focused on opening hosted services quickly,
monitoring health, surfacing incidents, alerts, notes, widgets, and
backup/restore.

The previous browser SSH/RDP/VNC remote-access manager and user credential vault
were intentionally removed before the current service-dashboard release line. Do
not assume Guacamole, saved remote credentials, sessions, or access tabs exist in
this codebase unless a future release reintroduces them.

**Sidebar views:** Dashboard, Monitoring, Alerts, Services, Admin.

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite + TypeScript (`src/client/`) |
| Backend | Fastify 5 + Zod + TypeScript (`src/server/`) |
| Database | SQLite via Prisma (`prisma/schema.prisma`) |
| Secret encryption | AES-256-GCM for alert webhook/SMTP configs (`src/server/vault.ts`) |
| Deploy | Docker Compose / GHCR |

---

## 2. Current Data Model

The active Prisma models are:

- `Resource`, `DashboardGroup`, `Tag`, `Note`
- `HealthCheck`, `HealthResult`
- `Incident`, `MaintenanceWindow`
- `AlertChannel`, `AlertRule`, `AlertDelivery`
- `DashboardWidget`, `DashboardLayout`
- `AuditEvent`, `AdminAccount`, `SystemConfig`

There are no active `Connection`, `Credential`, remote session, or Guacamole
models.

---

## 3. Deploy And Run

### Pull The Prebuilt Image

The image is private, so authenticate once on the Docker host:

```sh
echo <GH_PAT_with_read:packages> | docker login ghcr.io -u Kobii-git --password-stdin
docker compose pull
docker compose up -d
```

### Build From Source On The Docker Host

```sh
cd ~/homelab-dashboard
git pull
docker compose -f docker-compose.build.yml up -d --build
```

Data lives in the named Docker volume `homelab-dashboard-data`. It survives
`docker compose down`, container removal, image updates, and rebuilds. It is only
destroyed by `docker compose down -v` or deleting the volume.

### First Run

On first visit, the setup screen creates the single admin account and optionally
loads demo data. `COOKIE_SECRET` and `HOMELAB_VAULT_KEY` can be omitted; the app
generates and stores them in `SystemConfig`.

Pin these env vars in production if you want secrets to survive a DB reset:

```yaml
ADMIN_PASSWORD: your-password
COOKIE_SECRET: random-32-char-string
HOMELAB_VAULT_KEY: random-alert-config-key
```

`HOMELAB_VAULT_KEY` currently encrypts alert channel configs. It is not a user
credential-vault feature.

---

## 4. Feature State

### Dashboard

- Configurable widgets are backed by `DashboardWidget` records.
- Active default widget types are `favorites`, `serviceStatus`, `incidents`,
  `failingChecks`, and `notes`.
- Removed widget types such as `recentSessions` and `vaultHealth` should not be
  seeded anymore.

### Monitoring And Incidents

- Checks support HTTP, TCP, and ping.
- Checks track latest status, latency, failure reason, consecutive
  failures/successes, and transitions.
- Failing checks can create incidents.
- Incidents support open, acknowledged, resolved, muted, and maintenance-related
  workflows.

### Alerts

- Alert channels support SMTP email and generic webhooks.
- Channel configs are encrypted with AES-256-GCM.
- Client-facing serializers must never return plaintext webhook URLs or SMTP
  passwords.
- Delivery records track alert attempts and errors.

### Services

- Resources are presented as hosted services. They can be grouped, tagged,
  favorited, assigned launch URLs/hosts, and linked to health checks and notes.
- The Services page is compact by default; add/edit forms only open after an
  explicit action.
- Backup/restore exports configuration only: tags, groups, resources, checks,
  notes, alert channels/rules, maintenance windows, and widgets.
- Backup restore does not export incidents, check results, alert deliveries, or
  audit logs.

---

## 5. Auth And Secrets

- Single admin only.
- `ADMIN_PASSWORD` env var still works and bypasses web account creation.
- Otherwise an `AdminAccount` row stores the admin username and password hash.
- `COOKIE_SECURE=false` by default because the target deployment is plain HTTP on
  a private LAN. Set it to `true` only behind HTTPS.
- Public unauthenticated routes are intentionally limited to login/setup/status
  style endpoints. Protected API routes require the session cookie.
- `COOKIE_SECRET` signs cookies.
- `HOMELAB_VAULT_KEY` encrypts alert channel configs.

---

## 6. What Codex Has Done Recently

The project history includes an earlier V1/V2 remote manager with Guacamole,
session tabs, SSH/RDP/VNC work, and a credential vault. That work was later
removed from `main` in commit `8493d23` (`Remove SSH/RDP/VNC remote access and
credential vault`).

Recent cleanup and redesign passes:

- Fixed first-run setup so env-managed or existing-admin installs can dismiss the
  setup screen after logging in.
- Removed stale default dashboard widgets for `recentSessions` and `vaultHealth`.
- Updated the package version to `0.3.0` for the removal cleanup.
- Upgraded `@fastify/static` to a patched major version.
- Removed unused Guacamole env/test fields.
- Rewrote README and this handover to match the current monitoring-dashboard
  product.
- Updated backup UI copy so it describes encrypted alert configs, not a removed
  credential vault.
- `0.4.0` then redesigned the front door into a service-first launcher/status
  dashboard and renamed Inventory to Services in the UI.
- Cleaned old remote/session frontend leftovers from shared primitives and CSS.
- Moved the active Services view files to `src/client/features/services/`.
- Fixed backend static serving so source-mode backend runs do not serve raw
  `main.tsx`; single-port preview should use `npm run build && npm start`, while
  active local development should use `npm run dev:all`.
- Tightened the left sidebar and renamed the visible Settings area to Admin.

---

## 7. Local Development

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
npm audit --omit=dev
```

The test script creates a timestamped SQLite database under `data/` and runs
Vitest sequentially (`fileParallelism: false` in `vitest.config.ts`) to avoid
cross-test SQLite contention.

---

## 8. Versioning And Release

- Version lives in `package.json`.
- `src/shared/version.ts` reads the package version and exposes it through the UI
  and `/api/version`.
- `.github/workflows/docker.yml` publishes Docker images to GHCR on pushes to
  `main` and on `v*` tags.
- Tag pushes publish semver image tags. The workflow does not currently create a
  GitHub Release page.

Release checklist:

```sh
npm version patch --no-git-tag-version   # or minor / major
# update CHANGELOG.md and README badge/current version
npm run typecheck && npm test && npm run build
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

---

## 9. Known Limitations

- Single admin only; no multi-user roles.
- No built-in HTTPS; use a reverse proxy for HTTPS.
- No Docker, Hyper-V, or network auto-discovery.
- No embedded SSH/RDP/VNC remote sessions in the current app.
- No user credential vault in the current app.
- Alerts are limited to SMTP email and generic webhooks.
- Browser end-to-end coverage is still light compared with the API/unit tests.

---

## 10. Suggested Next Steps

- Decide whether remote access and a credential vault should stay removed or come
  back as a separate, deliberate feature set.
- Add browser tests for setup, demo data, dashboard widgets, alert creation, and
  backup/restore preview.
- Add richer monitoring history charts and retention controls for `HealthResult`.
- Add a first-class upgrade note or migration guide for anyone coming from the
  older remote-manager builds.
- Consider renaming `HOMELAB_VAULT_KEY` to a clearer alert-secret key in a future
  breaking release.
