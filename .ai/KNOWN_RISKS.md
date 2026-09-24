# Known durable risks

This is not a feature backlog. It records accepted or unresolved engineering risks that affect safe
changes. Priority reflects potential impact, not an instruction to expand the current task.

## P1 — Schema delivery has no versioned migration history

- **Risk:** development and container startup use Prisma `db push`; complex upgrades and downgrades
  cannot be reviewed or replayed as ordered migrations.
- **Rationale:** the current single-admin installation model and bounded startup backfills kept the
  initial workflow simple.
- **Compensating controls:** `db push` runs without `--accept-data-loss`; schema/backfill behavior is
  tested on disposable databases; operators are told to back up before schema upgrades.
- **Reconsider when:** a destructive/transformative schema change is required, installations grow,
  rollback expectations increase, or a second supported datastore/deployment appears.
- **Review point:** any `prisma/schema.prisma`, startup-backfill, or persisted JSON-format change.

## P1 — Full disaster recovery remains operator-managed

- **Risk:** recoverability depends on operator scheduling, encryption, off-host retention, integrity
  checks, and periodic restore drills; an existing backup file may be unusable.
- **Rationale:** portable configuration export/restore is supported and tested on disposable
  databases, but it intentionally excludes authentication, history, secrets, and deployment state.
  Full disaster recovery still depends on the operator.
- **Compensating controls:** a stop/copy/start/integrity/encryption/restore runbook exists and the
  launch checklist requires a successful drill.
- **Reconsider when:** support obligations/install count grow, the data model becomes harder to
  reconstruct, or missed/failed operator backups occur.
- **Review point:** database, image, volume, deployment-user, or Prisma tooling changes.

## P2 — Public contribution and release governance requires remote controls

- **Risk:** branch/tag protection, reviewer identity and private vulnerability reporting are remote
  settings, not guaranteed by source. The publication job still needs package-write/OIDC authority.
- **Controls:** PR and validation jobs have read-only tokens; checkout credentials are not persisted.
  Publication depends on successful validation in a separate job. Dependency builds run inside
  Docker without receiving the publishing token. Pinned actions/scanners and digest verification remain.
- **Before publication:** configure protected branches/tags, review workflow/dependency changes, enable
  private reporting and verify package visibility. Do not run contributor code in privileged jobs.
- **Review point:** CI permissions, triggers, third-party actions, fork workflows and repository visibility.

## P2 — No primary-language lint or formatting gate

- **Risk:** type-correct code can still accumulate consistency, dead-pattern, or maintainability
  defects, and formatting may vary by contributor.
- **Rationale:** the project currently relies on strict TypeScript, tests, review, and focused diffs;
  adding a formatter now could expose broad historical churn.
- **Compensating controls:** strict typecheck covers production and test TypeScript; mass formatting
  is prohibited during unrelated work; reviews inspect scope and readability.
- **Reconsider when:** contributor count or style churn grows, recurring issues appear, or a
  changed-file ratchet can be introduced without rewriting the repository.
- **Review point:** toolchain changes and repeated style/quality review findings.

## P3 — Accessibility automation covers selected states and severities

- **Risk:** default validation uses Chromium. The optional Firefox/WebKit/installed-Edge matrix
  still asserts only serious and critical axe violations on selected states; moderate and
  unvisited-state defects can reach a release unnoticed.
- **Rationale:** engine coverage supplements manual review; automated checks do not establish
  complete accessibility or validate every branded browser and device configuration.
- **Compensating controls:** `tests/e2e/app.spec.ts` asserts no serious or critical axe violations
  across login, primary views, palette, and drawer; reduced motion is applied to the browser
  context; `TESTING.md` requires manual keyboard, focus, semantics, contrast, zoom, and
  narrow-viewport review for affected flows.
- **Reconsider when:** additional browser engines are supported, the UI grows materially, or
  accessibility defects appear that the selected states or the severity filter would have missed.
- **Review point:** any `src/client/**`, shared DTO, modal/navigation, or Playwright configuration
  change.

## P3 — Environment-variable parity is maintained by review only

- **Risk:** `src/server/env.ts`, `.env.example`, `docker-compose.yml`, workflow inputs, operator
  documentation, and runtime diagnostics must agree, but nothing mechanically compares them, so a
  renamed, added, or removed variable can drift and surface only at deployment.
- **Rationale:** the variable set is small and changes rarely; a parity checker would need its own
  maintained inventory and could drift from the code it claims to verify.
- **Compensating controls:** production parsing and startup requirements are tested; `GUARDRAILS.md`
  requires every configuration source to be updated together; Runtime Health reports missing
  production configuration such as `APP_ORIGIN` and `TRUST_PROXY_CIDRS`.
- **Reconsider when:** the variable set grows, a drift-caused deployment failure occurs, or
  configuration must serve more than one deployment topology.
- **Review point:** any environment-variable, Compose, workflow input, or `src/server/env.ts`
  change.
