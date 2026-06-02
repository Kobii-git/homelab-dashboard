# Homelab Dashboard

A private, self-hosted command centre for your homelab. Launch SSH/RDP sessions in the browser, monitor service health, manage an encrypted credential vault, and get alerted when things break.

![Version](https://img.shields.io/badge/version-0.1.0-2dd4bf)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Dashboard** — grouped resource cards, status widgets, favorites
- **Remote Access** — browser-based SSH and RDP via Apache Guacamole `guacd`
- **Monitoring** — HTTP, TCP, and ping health checks with auto-incident creation
- **Vault** — AES-256-GCM encrypted credentials with folders and tags
- **Alerts** — webhook/email channels with rules, cooldowns, and delivery history
- **Inventory** — full CRUD for resources, connections, checks, and credentials
- **Command palette** — global search across everything (Ctrl K or `/`)

---

## Quick start with Docker (recommended)

**No git clone required.** The image is hosted on GitHub Container Registry.

### Authenticate once per machine

The image is in a private registry. Create a **GitHub PAT** with `read:packages` scope at
https://github.com/settings/tokens/new, then log in:

```sh
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u Kobii-git --password-stdin
```

This stores credentials in `~/.docker/config.json` — you only need to do it once per machine.

### One-command install

```sh
curl -fsSL https://raw.githubusercontent.com/Kobii-git/homelab-dashboard/main/docker-compose.yml \
  -o /tmp/homelab.yml && \
ADMIN_PASSWORD=your-password \
COOKIE_SECRET=$(openssl rand -hex 32) \
HOMELAB_VAULT_KEY=$(openssl rand -hex 16) \
docker compose -f /tmp/homelab.yml up -d
```

Open **http://localhost:4173** and log in with your `ADMIN_PASSWORD`.

> The `openssl rand` commands generate cryptographically random secrets automatically.
> Write down `ADMIN_PASSWORD` — you'll need it to log in.

### Using a `.env` file instead

If you prefer to keep secrets in a file:

```sh
mkdir homelab && cd homelab
curl -fsSL https://raw.githubusercontent.com/Kobii-git/homelab-dashboard/main/docker-compose.yml -o docker-compose.yml
cat > .env <<EOF
ADMIN_PASSWORD=your-strong-password
COOKIE_SECRET=$(openssl rand -hex 32)
HOMELAB_VAULT_KEY=$(openssl rand -hex 16)
EOF
docker compose up -d
```

---

## First-run demo data

On the first login after a fresh install, the dashboard detects that no resources exist and shows a **first-run setup screen**. A toggle lets you choose whether to load demo data before entering the dashboard.

The demo data includes sample resources, grouped by category, with health checks, SSH/RDP connections, an encrypted credential vault, an open incident, alert channel, and a pinned note — everything needed to explore the full feature set.

The choice is recorded in the database. The setup screen will not appear again once dismissed.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PASSWORD` | Yes | Single admin login password |
| `COOKIE_SECRET` | Yes | Signs the session cookie — minimum 32 characters |
| `HOMELAB_VAULT_KEY` | Yes | Encrypts stored credentials — minimum 16 characters |
| `DATABASE_URL` | Yes | Prisma SQLite path — default `file:/data/homelab.db` |
| `GUACD_HOST` | No | `guacd` host — default `guacd` in Docker |
| `GUACD_PORT` | No | `guacd` port — default `4822` |
| `PORT` | No | HTTP port — default `4173` |

> Keep this on a LAN, VPN, or private mesh network. There is no multi-user auth or HTTPS termination built in — put a reverse proxy (nginx, Caddy, Traefik) in front if exposing beyond localhost.

---

## Updating

```sh
docker compose pull
docker compose up -d
```

The database is persisted in a named volume (`homelab-dashboard-data`) and survives updates.

---

## Remote access setup

SSH and RDP sessions open in the browser through [Apache Guacamole](https://guacamole.apache.org/). The `guacd` container is included in `docker-compose.yml`.

To launch a session:
1. Add a **Resource** in Inventory (the server or VM)
2. Add a **Connection** to that resource (SSH on port 22, or RDP on port 3389)
3. Optionally attach a **Credential** from the vault so the password is filled automatically
4. Click the connection in the **Access** view

Credentials are decrypted server-side only at the moment of the Guacamole handshake — they are never sent to the browser.

---

## Local development

```sh
git clone https://github.com/Kobii-git/homelab-dashboard
cd homelab-dashboard
npm install
cp .env.example .env    # set secrets
npm run db:push
npm run dev:all         # API on :3000, frontend on :5173
```

Optional demo data:

```sh
HOMELAB_VAULT_KEY=dev-vault-key-change-me DATABASE_URL=file:../data/homelab.db npm run seed:demo
```

### Useful commands

| Command | Description |
|---|---|
| `npm run dev:all` | Start API and Vite dev server concurrently |
| `npm run build` | Production build |
| `npm test` | Run test suite |
| `npm run typecheck` | TypeScript type check |
| `npm run db:push` | Apply schema to SQLite |
| `npm run db:studio` | Open Prisma Studio |
| `npm run seed:demo` | Load demo data (needs env vars) |

### Building the Docker image locally

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
| Remote access | Apache Guacamole `guacd` + `guacamole-common-js` |
| Vault | AES-256-GCM (Node.js built-in `crypto`) |
| Container | Docker / GHCR |

---

## Versioning

Releases follow [Semantic Versioning](https://semver.org). See [CHANGELOG.md](CHANGELOG.md) for the full history.

Current: **v0.1.0**
