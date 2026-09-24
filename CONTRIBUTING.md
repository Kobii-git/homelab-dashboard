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
| Deployment | Docker and Forgejo Container Registry |

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
- Run the canonical local gate, `npm run validate`, before opening a PR. See `.ai/TESTING.md`
  for change-specific expectations and CI-only container and security scans.
- Use `package.json` as the version source of truth.

## Versioning

This project uses [Semantic Versioning](https://semver.org). Tag releases as `vMAJOR.MINOR.PATCH` on `main`.

The canonical repository is Forgejo and must be accessed over the operator-configured SSH remote. Keep both long-lived branches available:

- `main` is stable and publishes the `latest` and `main` images.
- `beta` is pre-release and publishes the `beta` image.

Forgejo Actions is defined in `.forgejo/workflows/`; `.github/workflows/` is retained as a compatible mirror for GitHub. Do not commit credentials, local databases, build output, dependency directories, Cosign private keys, or plaintext environment files. Manual image publishing must use the TLS registry in `REGISTRY_HOST`; plaintext registries are unsupported.

For the homepage browser matrix, install the Playwright Chromium/Firefox/WebKit binaries, then run
`HOMEPAGE_CROSS_BROWSER=1 npm run test:e2e`. Files run serially against a disposable database because
configuration revisions are shared. Real Safari, Edge, and Brave smoke checks remain distinct from
engine-level automation. ZIP and HTML parsing use pinned fflate/parse5 dependencies; Vitest is pinned
to the patched 4.1.11 release.

To smoke-test an installed Microsoft Edge in a disposable profile, use `HOMEPAGE_EDGE=1 npx playwright test --project=edge`. This does not use your everyday browser profile.

The optional browser matrix allocates private test servers on ports 4180 onward, with a separate temporary database for each browser. Keep those ports free; the runner will not reuse an existing app.
