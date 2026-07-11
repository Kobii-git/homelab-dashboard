# Contributing

## Development setup

```sh
npm ci
cp .env.example .env
npm run db:push
npm run dev:all        # API on :4173, Vite UI on :5173
```

Optional demo data:

```sh
DATABASE_URL=file:../data/homelab.db npm run seed:demo
```

## Stack and scope

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Lucide icons |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma |
| Deployment | Docker and GHCR |

The active product is a single-admin service dashboard. Remote desktop protocols, credential vaults, multi-user roles, mutating integration calls, incidents, alerts, and executable widgets are out of scope.

## Project layout

```text
src/client/   React SPA
src/server/   Fastify API, monitoring, integrations
src/shared/   Shared DTOs and constants
prisma/       Active schema
tests/        Vitest routes and Playwright UI/accessibility tests
```

## Guidelines

- Keep changes focused and preserve the active model/scope in `AGENTS.md`.
- Never return or persist integration credentials. Custom API-widget secret names require `API_WIDGET_SECRET_ALLOWLIST`.
- Keep browser mutation origin checks, response limits, redirect blocking, and public-status minimization intact.
- Run `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run audit:production`, and `npm run audit:all` before opening a PR.
- Use `package.json` as the version source of truth.

## Versioning

This project uses [Semantic Versioning](https://semver.org). Tag releases as `vMAJOR.MINOR.PATCH` on `main`.
