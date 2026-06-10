# Homelab Dashboard

A private, self-hosted dashboard for the services you run at home. It is a simple LAN/VPN app for launching hosted web services, grouping them, favoriting the important ones, and seeing basic health status without turning the project into a remote desktop manager.

![Version](https://img.shields.io/badge/version-0.5.0-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Dashboard** - compact service launcher with favorites, status filters, health mix, and latency signals
- **Services** - manual catalog for apps, websites, Docker services, VMs, servers, and other devices
- **Health checks** - HTTP, TCP, ping, and SSL checks with latest status, latency, failure reason, thresholds, and check history
- **Admin** - password change, public status page, theme toggle, setup reset, build info, and demo-data controls
- **Status page** - unauthenticated `/status` view for a simple wallboard or uptime bookmark

Remote SSH/RDP/VNC access, Guacamole, saved credentials, vaults, alert channels, incidents, widgets, backup/restore, tags, and notes are intentionally out of the current app scope.

---

## Current Scope

Version `0.5.0` is a focused service dashboard. The app remains designed for one trusted admin on a private LAN, VPN, or private mesh network. It does not include multi-user roles, network discovery, Docker discovery, Hyper-V discovery, or built-in HTTPS termination.

The active database model is intentionally small: `Resource`, `DashboardGroup`, `HealthCheck`, `HealthResult`, `AdminAccount`, and `SystemConfig`.

---

## Quick Start With Docker

### Authenticate To The Private Image Registry

```sh
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u Kobii-git --password-stdin
```

Create a GitHub PAT with `read:packages` scope at <https://github.com/settings/tokens/new>. Docker stores the login in `~/.docker/config.json`, so you only need to do this once per machine.

### Install

```sh
curl -fsSL https://raw.githubusercontent.com/Kobii-git/homelab-dashboard/main/docker-compose.yml \
  -o /tmp/homelab.yml && docker compose -f /tmp/homelab.yml up -d
```

Open **http://localhost:4173**. On first visit you will be prompted to create the admin account and optionally load demo data.

### Optional Environment Variables

```yaml
ADMIN_PASSWORD: your-password        # optional; skips web account creation
COOKIE_SECRET: random-32-char-string # optional; persistent sessions across DB resets
```

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | No | Skip web account creation and use this password instead |
| `COOKIE_SECRET` | No | Signs session cookies; auto-generated if unset |
| `COOKIE_SECURE` | No | Set to `true` only when serving over HTTPS. Default is `false` for plain-HTTP LAN use |
| `DATABASE_URL` | No | Prisma SQLite path; default `file:/data/homelab.db` in Docker |
| `PORT` | No | HTTP port; default `4173` |

Keep this behind a LAN, VPN, or private mesh network. If exposing it beyond that, put a reverse proxy such as Caddy, nginx, or Traefik in front and enable HTTPS.

---

## Updating

```sh
docker compose pull
docker compose up -d --force-recreate
```

The SQLite database is stored in the named Docker volume `homelab-dashboard-data` and survives updates.

When upgrading from older pro-console or remote-manager builds, startup creates a one-time SQLite backup at `/data/homelab.before-v0.5-schema.db` before applying the simplified schema cleanup.

---

## Local Development

```sh
git clone https://github.com/Kobii-git/homelab-dashboard
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

---

## Stack

| Component | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma ORM |
| Container | Docker / GHCR |

---

## Versioning

Current: **v0.5.0**

Verify the running build:

```sh
curl -s http://localhost:4173/api/version
```

The sidebar, login screen, `/status` page, and `/api/version` all expose the baked version and git hash.
