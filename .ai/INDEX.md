# AI context index

Read `AGENTS.md` first. Then select the smallest matching row below; normally load no more than
three deeper documents. Source and executable configuration remain authoritative.

| Task | Load |
|---|---|
| Small documentation correction | `GUARDRAILS.md` |
| UI or client-state change | `ARCHITECTURE.md`, `TESTING.md`, `GUARDRAILS.md` |
| API route or public-response change | `SECURITY.md`, `TESTING.md`, `GUARDRAILS.md` |
| Authentication, reauthentication, or setup | `SECURITY.md`, `TESTING.md`, `GUARDRAILS.md` |
| Prisma schema, stored state, retention, or seed change | `DATA_MODEL.md`, `TESTING.md`, `GUARDRAILS.md` |
| Health-check or outbound-network change | `INTEGRATIONS.md`, `SECURITY.md`, `TESTING.md` |
| OPNsense, Glances, API widget, utility, icon, or AI-provider change | `INTEGRATIONS.md`, `SECURITY.md`, `TESTING.md` |
| Docker, Compose, runtime configuration, or release workflow | `DEPLOYMENT.md`, `SECURITY.md`, `GUARDRAILS.md` |
| Dependency, script, or toolchain change | `COMMANDS.md`, `TESTING.md`, `GUARDRAILS.md` |
| Architecture or scope proposal | `ARCHITECTURE.md`, `KNOWN_RISKS.md`, `GUARDRAILS.md` |
| Independent review | `REVIEW_CHECKLIST.md`, `GUARDRAILS.md`, `TESTING.md` |
| Command discovery or validation report | `COMMANDS.md`, `TESTING.md` |

## Document ownership

- `GUARDRAILS.md`: touch-point obligations and their control strength.
- `ARCHITECTURE.md`: runtime components, responsibilities, boundaries, and high-blast-radius areas.
- `COMMANDS.md`: canonical command inventory and point-in-time verification status.
- `TESTING.md`: change-to-validation mapping.
- `SECURITY.md`: internal trust, authentication, public-route, and secret-handling rules.
- `DATA_MODEL.md`: persistence responsibilities and data-change constraints.
- `DEPLOYMENT.md`: supported runtime and release topology.
- `INTEGRATIONS.md`: outbound integration contracts and failure boundaries.
- `KNOWN_RISKS.md`: accepted or unresolved durable engineering risks, not feature backlog.
- `REVIEW_CHECKLIST.md`: diff-triggered review prompts.

Human-facing product and operator documentation remains authoritative for its audience: `README.md`,
`CONTRIBUTING.md`, root `SECURITY.md`, `FORGEJO.md`, and `docs/`. Optional `.ai/local/` content is
private machine/user context; never copy it into repository artifacts.
