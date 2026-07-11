# Contributing

## Development setup

```sh
npm install
cp .env.example .env   # fill in secrets
npm run db:push
npm run dev:all        # API on :3000, UI on :5173
```

Optional demo data:

```sh
HOMELAB_VAULT_KEY=dev-vault-key-change-me DATABASE_URL=file:../data/homelab.db npm run seed:demo
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Lucide icons |
| Backend | Fastify 5, Zod validation |
| Database | SQLite via Prisma |
| Remote access | Apache Guacamole `guacd` |
| Vault | AES-256-GCM (Node.js `crypto`) |

## Project layout

```
src/
  client/       React SPA
  server/       Fastify API, routes, vault, health checks
  shared/       Types shared between client and server
prisma/         Schema and migrations
scripts/        Legacy – seed entry point moved to src/server/seed.ts
```

## Guidelines

- Keep PRs focused. One concern per PR.
- Run `npm run typecheck` and `npm test` before opening a PR.
- No new runtime dependencies without discussion.
- Secrets never leave the server: credentials are decrypted only at the point of use (Guacamole handshake or explicit vault reveal).

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable, triggers Docker image build |
| `beta` | Pre-release staging |

## Versioning

This project uses [Semantic Versioning](https://semver.org). Tag releases as `vMAJOR.MINOR.PATCH` on `main`.
