# Project guardrails

Control labels mean:

- **Automated**: a repository gate directly checks the obligation.
- **Instruction**: repository rules require it, but enforcement is not complete.
- **Manual review**: a reviewer must inspect behavior or configuration.
- **Unresolved**: a future control is warranted and tracked in `KNOWN_RISKS.md`.

## Touch-point rules

### Commands, dependencies, and generated clients

If you touch `package.json`, the lockfile, Node/Prisma versions, or command scripts, inspect
`package-lock.json`, Docker/CI runtime versions, `CONTRIBUTING.md`, and `.ai/COMMANDS.md`. Run the
changed command plus `npm run validate`; dependency changes also require both audit scripts.

Controls: **Automated** by lockfile installs, typecheck/tests/build, audits, and CI scanners;
**manual review** for runtime/version alignment. Never hand-edit generated Prisma client files.

### TypeScript source or configuration

If you touch production or test TypeScript, run `npm run typecheck` and the relevant Vitest or
Playwright suite. New source locations must be included by an active TypeScript configuration.

Controls: **Automated** by the client, server, and test TypeScript projects.

### UI and user-visible behavior

If you touch `src/client/`, inspect the related API DTOs and responsive styles, run the relevant
tests, and run Playwright for interaction, navigation, modal, or accessibility behavior. Manually
review keyboard operation, focus order/visibility, semantics, contrast, zoom, responsive layout,
and error messaging when the change can affect them.

Controls: **Automated** for selected Chromium flows and serious axe findings; **manual review** for
the rest of accessibility and visual behavior.

### API routes and public responses

If you add or change a route, inspect the global hooks and explicit public-route set in
`src/server/app.ts`, plus `src/server/routes/status.ts` when applicable. Add success, invalid-input,
unauthenticated, and forbidden/negative tests appropriate to the route. Public output must remain
minimal and intentional.

Controls: **Automated** by route tests; **manual review** for public exposure and response minimization.

### Authentication and sensitive mutations

If you touch login, setup, password, cookies, session invalidation, recent reauthentication, rate
limits, origin enforcement, or the sensitive-mutation classifier, inspect `src/server/auth.ts`,
`src/server/rateLimit.ts`, and the request hooks in `src/server/app.ts`. Test expiry, invalid tokens,
wrong-origin requests, unauthenticated access, and active-session binding as relevant.

Controls: **Automated** by negative route tests; **manual security review** is mandatory.

### Outbound requests and admin-defined targets

If you add outbound HTTP/TCP/TLS/DNS behavior or a target field, route it through
`src/server/outboundPolicy.ts` and the bounded/pinned helpers used by neighboring code. Preserve DNS
resolution checks, forbidden-address blocking, fixed-provider allowlists and limits, timeout
budgets, response-size bounds, redirect policy, TLS verification, and credential redaction. Test
failure, rebinding/redirect, timeout, and size-limit behavior.

Controls: **Automated** by outbound-policy and integration tests; **manual review** for threat-model fit.

### Environment configuration and secrets

If you add, rename, or remove an environment variable, update `src/server/env.ts`, `.env.example`,
relevant Compose/workflow inputs, operator documentation, runtime diagnostics, and tests. Examples
must contain names and safe placeholders only. Secret values stay in environment/secret stores and
must not enter SQLite, responses, logs, backups documentation, or AI files.

Controls: **Instruction** plus tests for core production parsing; **manual review** for cross-file
parity. Mechanical configuration-parity checking remains a maturity improvement.

### Prisma schema, persistent formats, and retention

If you touch `prisma/schema.prisma`, `SystemConfig` formats, sample retention, relationships, or
deletion behavior, inspect `DATA_MODEL.md` and the backup/restore runbook. Demonstrate the change on
a disposable database, test upgrade/backfill and destructive behavior, document rollback limits,
and never run it against real data. Do not use `--accept-data-loss` to force a pass.

Controls: **Automated** for schema push and route behavior; **unresolved** for versioned migrations
and automated upgrade/restore rehearsal.

### Integration credentials and bindings

If you touch OPNsense, AI-provider, or API-widget authentication, preserve environment-only secret
values, verified HTTPS by default, origin binding where applicable, diagnostic redaction, and the
emergency nature of insecure overrides. Credential destination changes require recent admin
reauthentication and explicit confirmation.

Controls: **Automated** by integration and reauthentication tests; **manual security review**.

### Docker, deployment, CI, and release metadata

If you touch the Dockerfile, Compose files, `.dockerignore`, deployment docs, or workflows, inspect
`DEPLOYMENT.md` and `SECURITY.md`. Preserve non-root execution, read-only root filesystem support,
dropped capabilities, bounded writable storage, health checks, TLS registry use, pinned privileged
actions/images, scans, SBOM/provenance, and signed digest publication. Run local build/smoke checks
when available; do not publish or deploy.

Controls: **Automated** in CI for container/security checks; **manual review** for permission scope,
workflow gate preservation, upgrade, and rollback.

### Version and release documentation

If you change the application version, update `package.json` first, then reconcile the lockfile,
README badge/text, changelog, release notes, image metadata, and tags as applicable. Do not create a
tag or release during ordinary implementation.

Controls: **Instruction** and stale-copy check; **manual review** for all version references.

### Local/private AI context

If you use `.ai/local/`, keep it ignored and secret-free. Never use local preferences as shared
architecture truth or copy them into a commit, issue, pull request, release note, or public report.

Controls: **Automated** by `.gitignore`; **manual review** for accidental disclosure.
