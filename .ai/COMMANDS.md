# Command inventory

`package.json` is authoritative for npm commands. Statuses below are point-in-time observations from
2026-08-16; rerun relevant commands after changes and report exact results.

| Intent | Canonical command | Source | Status | Important limitation |
|---|---|---|---|---|
| Reproducible install | `npm ci` | lockfile + CI | VERIFIED | Replaces `node_modules`; install scripts and the generated Prisma client must be reviewed as dependency code. |
| Full local gate | `npm run validate` | `package.json` | VERIFIED | Includes browser tests and network-dependent audits; excludes Docker/security scanners. |
| Stale duplicate check | `npm run check:stale-files` | `package.json` | VERIFIED | Rejects filenames matching the repository's stale-copy pattern, not arbitrary duplicate content. |
| Type checking | `npm run typecheck` | `package.json` + TypeScript configs | VERIFIED | Covers server, shared, client, tests, scripts, and test/build configs after this pass. |
| Unit/integration routes | `npm test` | `package.json` + `vitest.config.ts` | VERIFIED | Uses a temporary SQLite database with cleanup; tests run sequentially. |
| Production build | `npm run build` | `package.json` | VERIFIED | Removes and recreates ignored `dist/`; generates Prisma Client. |
| Browser/accessibility | `npm run test:e2e` | `package.json` + Playwright config | VERIFIED | Builds first, uses Chromium by default (optional HOMEPAGE_CROSS_BROWSER matrix) and a temporary SQLite database, and requires port 4180. |
| Development | `npm run dev:all` | `package.json` | DECLARED | Long-running; applies the default development schema before listening on 4173/5173. |
| Production process | `npm start` | `package.json` | DECLARED | Requires a completed build, configured database, and valid production environment. |
| Disposable schema push | `DATABASE_URL=file:/absolute/disposable.db npm run db:push` | `package.json` + Prisma | VERIFIED | Never point this command at real data during validation; no versioned migration history exists. |
| Demo seed | `DATABASE_URL=file:/absolute/disposable.db npm run seed:demo` | `package.json` | VERIFIED | Mutates the selected database; verified only with disposable test data. |
| Prisma Studio | `npm run db:studio` | `package.json` | DECLARED | Interactive and data-mutating; do not use against production during ordinary work. |
| Dependency audits | `npm run audit:production` and `npm run audit:all` | `package.json` | VERIFIED | Depend on registry advisory availability and are point-in-time results. |
| Local image build | `docker build -t <local-tag> .` | `Dockerfile` | VERIFIED | Mutates local Docker cache/image state; the task-created image was removed after its smoke test. |
| Local image build/run | `docker compose -f docker-compose.build.yml up -d --build` | Compose | DECLARED | Mutates local Docker state and starts a service; not part of the npm local gate. |
| Published deployment | `docker compose pull` / `docker compose up -d` | operator docs | DECLARED | External/production mutation; restricted without explicit instruction. |
| Backup/restore | runbook commands in `docs/BACKUP_AND_RESTORE.md` | operator runbook | DECLARED | Stop/start, copy, and restore real state; never run as routine validation. |
| Formatting | none | repository | MISSING | Do not mass-format or claim formatting enforcement. |
| Linting | none | repository | MISSING | Typecheck is not a linter; CI does not provide a primary-language lint gate. |
| Packaging/release | publishing workflows | Forgejo/GitHub workflow files | DECLARED | Remote publication is forbidden during local standardisation. |

CI additionally runs Gitleaks, Trivy filesystem/Docker/image/SBOM checks, startup and hardened
container smokes, ZAP baselines, SBOM/provenance generation, and Cosign signing/verification. Those
are workflow controls, not local npm commands, and must not be reported as locally verified unless
their exact steps were executed.
