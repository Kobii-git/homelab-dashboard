# Contributing

## Development setup

```sh
npm ci
cp .env.example .env
npm run db:push
npm run dev:all        # API on :4173, Vite UI on :5173
```

Optional demo data, only in a disposable development database (never production):

```sh
DATABASE_URL=file:../data/demo.db npm run seed:demo
```

## Stack and scope

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript, Lucide icons |
| Backend | Fastify 5, Zod, TypeScript |
| Database | SQLite via Prisma |
| Deployment | Docker and GitHub Container Registry |

The active product is a single-admin browser homepage, bookmark manager, and service dashboard. Remote desktop protocols, credential vaults, multi-user roles, mutating integration calls, incidents, alerts, and executable widgets are out of scope.

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

This project uses [Semantic Versioning](https://semver.org). Bump `package.json` and the root lockfile versions for shipped app changes, and update the README and changelog. The signed-in header displays that version so operators can verify updates. Tag releases as `vMAJOR.MINOR.PATCH` on `main`.

The canonical repository is [Kobii-git/homelab-dashboard on GitHub](https://github.com/Kobii-git/homelab-dashboard). Use authenticated HTTPS or SSH. Keep both long-lived branches available:

- `main` is stable and publishes the `latest` and `main` images.
- `beta` is pre-release and publishes the `beta` image.

GitHub Actions in `.github/workflows/` is the canonical pipeline. Do not commit credentials, local databases, build output, dependency directories, private keys, or plaintext environment files. Images use GHCR over trusted HTTPS; GitHub Actions signs image digests with its OIDC identity. See `GITHUB.md`.

For the homepage browser matrix, install the Playwright Chromium/Firefox/WebKit binaries, then run
`HOMEPAGE_CROSS_BROWSER=1 npm run test:e2e`. Files run serially against a disposable database because
configuration revisions are shared. Real Safari, Edge, and Brave smoke checks remain distinct from
engine-level automation. ZIP and HTML parsing use pinned fflate/parse5 dependencies; Vitest is pinned
to the patched 4.1.11 release.

To smoke-test an installed Microsoft Edge in a disposable profile, use `HOMEPAGE_EDGE=1 npx playwright test --project=edge`. This does not use your everyday browser profile.

The optional browser matrix allocates private test servers on ports 4180 onward, with a separate temporary database for each browser. Keep those ports free; the runner will not reuse an existing app.

## Pull requests and licensing

Fork the repository, create a focused branch, and open a pull request against `main`. Describe the
problem, tests, compatibility and recovery implications. Do not include production data or secrets.
Use GitHub's private email setting and a GitHub-provided noreply Git identity if you do not want your
email published in commits; changing a profile setting does not rewrite existing Git history.

Submit only work you have the right to contribute under the project's MIT license. Preserve existing
copyright and license notices. Identify copied code/assets and their sources; do not assume an image
found online is redistributable. No contributor license agreement or copyright transfer is required.
When dependencies change, run `npm run licenses:generate` after `npm ci`, inspect notices, then run
`npm run validate`. The generated notices include production dependencies, including browser bundles.

Fork pull requests use a read-only validation workflow without publishing credentials. Maintainers
must review workflow and dependency changes before merging. Do not use `pull_request_target` to
execute contributor code. Security reports belong in the private channel in `SECURITY.md`.
