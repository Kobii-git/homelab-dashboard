# Homelab Dashboard

A private, self-hosted command center for your homelab. Track services, websites, VMs, and devices from one LAN/VPN-only dashboard with health checks, incidents, alerts, notes, backup/restore, and a dense console UI.

![Version](https://img.shields.io/badge/version-0.4.4-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Dashboard** - service launchpad with status filters, health mix, response-time bars, incidents, and pinned notes
- **Monitoring** - HTTP, TCP, and ping checks with response time, failure reasons, thresholds, and status transitions
- **Incidents** - open, acknowledge, resolve, mute, and maintenance-suppress service failures
- **Alerts** - SMTP email and generic webhook channels with rules, cooldowns, and delivery history
- **Services** - compact catalog for launch URLs, groups, tags, health checks, and notes
- **Backup / restore** - JSON export/import for configuration, including encrypted alert channel config blobs
- **Command palette** - global search and quick actions with `Ctrl K` or `/`
- **Admin** - password change, status page, sync tools, keyboard help, theme controls, and build info

> **New here?** See [HANDOVER.md](HANDOVER.md) for the current architecture, deployment notes, and project state.

---

## Current Scope

Version `0.4.4` is intentionally a service launch/status dashboard. The previous SSH/RDP/VNC remote-access manager and user credential vault were removed before this release line. Browser-based remote access can be planned again later, but it is not part of the current app or Docker Compose stack.

The app remains designed for one trusted admin on a private LAN, VPN, or private mesh network. It does not include multi-user roles or built-in HTTPS termination.

---

## Quick Start With Docker

**No configuration required.** The app sets itself up on first boot.

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

### What First-Run Setup Does

1. Creates the single admin account, stored as a salted password hash in SQLite.
2. Optionally loads demo resources, checks, an incident, alert config, and a pinned note.
3. Auto-generates the cookie signing key and alert encryption key if they are not provided.

### Pinning Secrets

The app can generate secrets automatically and persist them in the database. For production, you can also pin them in `docker-compose.yml`:

```yaml
ADMIN_PASSWORD: your-password        # optional; skips web account creation
COOKIE_SECRET: random-32-char-string # persistent sessions across DB resets
HOMELAB_VAULT_KEY: random-key        # encrypts alert webhook/SMTP configs
```

---

## Demo Data

On the first login after a fresh install, the dashboard detects that no resources exist and shows a setup screen. The demo toggle loads sample groups, resources, health checks, alert rules, an open incident, and a pinned note so you can explore the console quickly.

The choice is recorded in the database. The setup screen will not appear again once dismissed.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | No | Skip web account creation and use this password instead |
| `COOKIE_SECRET` | No | Signs session cookies; auto-generated if unset |
| `COOKIE_SECURE` | No | Set to `true` only when serving over HTTPS. Default is `false` for plain-HTTP LAN use |
| `HOMELAB_VAULT_KEY` | No | Encrypts alert webhook/SMTP configs; auto-generated and persisted if unset |
| `DATABASE_URL` | No | Prisma SQLite path; default `file:/data/homelab.db` in Docker |
| `PORT` | No | HTTP port; default `4173` |

Keep this behind a LAN, VPN, or private mesh network. If exposing it beyond that, put a reverse proxy such as Caddy, nginx, or Traefik in front and enable HTTPS.

---

## Updating

```sh
docker compose pull
docker compose up -d
```

The SQLite database is stored in the named Docker volume `homelab-dashboard-data` and survives updates.

When upgrading from older remote-manager builds, startup creates a one-time
SQLite backup at `/data/homelab.before-v0.4-schema.db` before applying the schema
cleanup that removes old SSH/RDP/Vault tables.

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

For a single-port local preview on `:4173`, run `npm run build` and then `npm start`.

Optional demo data:

```sh
HOMELAB_VAULT_KEY=dev-alert-config-key DATABASE_URL=file:../data/homelab.db npm run seed:demo
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
| Secret encryption | AES-256-GCM for alert channel configs |
| Container | Docker / GHCR |

---

## Versioning

Releases follow [Semantic Versioning](https://semver.org). See [CHANGELOG.md](CHANGELOG.md) for the full history.

Current: **v0.4.4**

### Verify Your Running Build

| Where | What to look for |
|---|---|
| **Sidebar** | `v0.4.4 · abc1234` in the build badge |
| **Login screen** | Same build badge under the Unlock button |
| **`/status` page** | Version and git hash under the title |
| **API** | `curl -s http://localhost:4173/api/version` |

The short hash (`abc1234`) is the git commit baked into the Docker image at build time.

### Release A New Version

```sh
# 1. Bump version and update CHANGELOG.md
npm version patch --no-git-tag-version   # or minor / major

# 2. Commit, tag, and push
git add -A && git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

Pushing `main` publishes `latest` and `sha-*` images to GHCR. Pushing a `v*` tag also publishes versioned image tags.
