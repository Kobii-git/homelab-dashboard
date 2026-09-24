# Testing and validation

Use the smallest sufficient gate while iterating, then run the aggregate local gate for substantial
or cross-cutting changes. Any skipped gate must be reported with the reason and consequence.

| Change class | Required validation |
|---|---|
| Documentation only | `npm run check:stale-files`; inspect links and diff. Run code gates only if the documentation changes executable examples or configuration claims. |
| Isolated server/shared helper | `npm run typecheck`; targeted Vitest; `npm test` before handoff. |
| Client UI or state | `npm run typecheck`; relevant Playwright flow; full Playwright for navigation, modal, responsive, or accessibility impact. |
| API route/DTO | `npm run typecheck`; route tests covering success, invalid input, unauthenticated/forbidden access, and public minimization as applicable. |
| Authentication/setup/reauth | Full route suite plus explicit negative, expiry, origin, rate-limit, invalidation, and active-session-binding cases relevant to the change. |
| Outbound network/security control | Full route suite with forbidden destination, DNS/redirect/rebinding, timeout, response-size, TLS, and secret-redaction cases relevant to the change. |
| Prisma schema or stored format | Disposable `db:push`; upgrade/backfill tests; full route suite; build; inspect backup/restore and rollback consequences. |
| Scheduler/retention | Unit/route tests for due selection, stale outcomes, failure handling, retention deletion, and shutdown; typecheck and build. |
| Integration | Targeted integration tests using local fakes; failure/redaction tests; full route suite. Never contact a production integration. |
| Dependency/toolchain | `npm ci` in a disposable/clean environment, typecheck, tests, build, Playwright where affected, and both audits. |
| Docker/Compose | Build image; production startup and health smoke; verify non-root/read-only/capability settings. CI-equivalent scans are required before publication. |
| Workflow/release | Syntax/action review, workflow-mirror comparison, least-privilege and immutable-pin review, plus all gates the changed workflow claims. Never publish while validating. |
| Security header/public status | Route tests in enabled and disabled modes; inspect unauthenticated output; relevant ZAP baseline before release. |

## Aggregate gates

- `npm run validate` is the canonical full local gate: stale-copy check, all TypeScript projects,
  Vitest, production build, Playwright/axe, and both npm audits.
- The Forgejo workflow is the canonical publication pipeline. Its GitHub-compatible mirror must
  retain equivalent controls. CI adds scanners, startup/container smokes, ZAP, SBOM/provenance, and
  signature verification that the npm gate does not reproduce.

## Accessibility and manual review

Automated axe checks cover selected rendered states and serious findings only. For affected flows,
manually assess keyboard-only completion, focus movement/restoration and visibility, semantic names
and status/error announcements, contrast, zoom, reduced motion, and narrow viewport behavior. Do not
claim standards compliance from an automated scan alone.

## Data and process safety

- Use unique disposable SQLite files. Never point tests, schema commands, seeding, or restore drills
  at the operator database.
- Playwright owns port 4180 (and subsequent ports for the optional browser matrix), gives each
  browser its own disposable database/server, and is configured not to reuse an existing server; a collision should
  fail instead of testing or mutating an unrelated process.
- Vitest intentionally disables file parallelism because test files share one database per run.
- Remove temporary known-bad fixtures and task-created disposable databases before handoff.
- Inspect outputs and exit codes. A command that ran before a code/config change does not validate
  the changed state.
