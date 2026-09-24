# Homelab Dashboard Repository Standard

Homelab Dashboard is a private, single-admin, self-hosted React and Fastify application for
launching services and observing read-only homelab signals. Start with this file, then use
[`.ai/INDEX.md`](.ai/INDEX.md) to load only the context relevant to the task.

## Authority and evidence

- Executed behavior and tests outrank source comments and documentation.
- Source and executable configuration outrank maintained documentation; maintained
  documentation outranks historical notes and conventions.
- Treat `package.json` as the application-version and command source of truth.
- Treat `prisma/schema.prisma` as the data-schema source of truth.
- When evidence conflicts, follow the implementation, report the drift, and update durable
  documentation when the correction is in scope.
- Label material claims `VERIFIED`, `DECLARED`, `INFERRED`, or `UNKNOWN`. Never present an
  unexecuted command or inferred behavior as verified.

## Repository safety

- Record the branch, HEAD, staged changes, modified files, and untracked files before editing.
- All pre-existing changes are user-owned. Preserve them and keep unrelated work out of the diff.
- Do not reset, clean, revert, overwrite, or delete user work. Never rewrite Git history.
- Never expose real credentials, tokens, private keys, cookies, network inventories, or private
  service data in output, fixtures, documentation, logs, or commits.
- Use disposable local data for schema, migration, restore, and destructive-operation tests.
- Do not weaken authentication, authorization, origin checks, outbound policy, TLS verification,
  response bounds, security headers, tests, or scanners to obtain a passing result.

## Risk classification

### SAFE

Focused documentation corrections, local inspection, tests, small helpers, narrow UI fixes,
AI-document updates, and missing ignore rules may be implemented and validated locally.

### CAUTION

Dependencies, public or API behavior, authentication, database schema, persistence, CI/CD,
containers, deployment, external integrations, and security-sensitive configuration require a
bounded plan, relevant tests, compatibility review, and an explicit diff self-review. If the
change cannot be demonstrated safely and locally, document the gap instead.

### RESTRICTED

Do not access production data or secrets; perform production restore or destructive migration;
weaken controls; add broad suppressions; change licensing; rewrite history; discard user work;
commit, push, merge, tag, publish, release, deploy, or modify remote settings unless the user gives
separate explicit authorization for that action.

The highest applicable risk class governs a mixed task.

## Standard workflow

1. Read this file and route through `.ai/INDEX.md`; normally load no more than three deeper files.
2. Inspect the relevant source, configuration, tests, and neighboring patterns before proposing a
   change.
3. Classify the task type and risk. For substantial work, state the objective, affected areas,
   guardrails, compatibility, security, data, deployment, validation, documentation, and recovery
   impact.
4. Implement the smallest coherent change. Do not combine standardisation or a bug fix with broad
   refactoring, dependency churn, mass formatting, or feature work.
5. Run the verified commands mapped in `.ai/TESTING.md`. Inspect their output; silent or
   suspiciously fast gates require investigation.
6. Walk every applicable “touch X” rule in `.ai/GUARDRAILS.md`.
7. Review the actual diff for correctness, scope, security, secrets, data integrity, compatibility,
   tests, generated files, and documentation drift.
8. Update durable documentation only when durable behavior or a maintained decision changed.
9. Report exact commands and results, unexecuted validation and why, remaining uncertainty, risks,
   and any deviation from the plan.

## Planner, implementer, and reviewer behavior

- A planner inspects first, separates facts from proposals, references real paths or symbols,
  identifies approvals and guardrails, and produces an implementation-ready validation plan.
- An implementer verifies inherited assumptions against current code, makes the smallest complete
  change, validates it, and reports deviations.
- A reviewer reads the request and actual diff, ranks only actionable findings by severity, and
  evaluates correctness, architecture, security, compatibility, data, tests, deployment,
  operations, and unnecessary scope. Do not manufacture findings.

## Project scope and durable knowledge

- Preserve the product boundary documented in the README. Do not reintroduce removed remote-access,
  credential-vault, multi-user, alerting, incident, executable-widget, discovery, or mutating
  integration scope without explicit product direction.
- Keep the single-admin and private LAN/VPN deployment assumptions explicit. Public status remains
  an opt-in deployment mode; direct internet exposure is unsupported.
- Keep outbound integrations read-only and route admin-defined destinations through the shared
  outbound policy and bounded request helpers.
- Never store OPNsense, AI-provider, or API-widget credential values in SQLite or return them from
  runtime diagnostics.
- Do not copy session notes, chat history, temporary plans, credentials, or machine-specific paths
  into committed AI documentation.
- `.ai/local/` is ignored private context. It must never contain secrets or be copied into commits,
  issues, releases, or public documentation.

## Validation honesty

- Commands and their current status live in `.ai/COMMANDS.md`; test selection lives in
  `.ai/TESTING.md`. Do not duplicate command bodies here.
- A passing test runner does not imply test TypeScript, accessibility, containers, audits, or
  production behavior were checked unless those gates actually ran.
- Never disable a failing gate. Identify the cause, fix it within scope, or report it as a gap.
- Do not claim completion while temporary fixtures, generated test databases, or unexplained build
  artifacts from the task remain.

## Documentation routing

Use [`.ai/INDEX.md`](.ai/INDEX.md) as the canonical router. Human-facing deployment procedures remain
in `docs/`, public vulnerability reporting remains in `SECURITY.md`, and contributor setup remains
in `CONTRIBUTING.md`.
