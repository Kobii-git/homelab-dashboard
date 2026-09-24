# Homepage implementation validation

Validation date: 2026-09-24. Reference environment: Apple M5, macOS arm64, Node 22.22.3.
All data used for the checks below was disposable. No production deployment, certificates, data,
credentials, DNS records, or remote repository settings were changed.

## Executed checks

**VERIFIED:** `HOMEPAGE_CROSS_BROWSER=1 HOMEPAGE_EDGE=1 npm run validate` passed:

- stale-file checks and all three TypeScript projects;
- 83 Vitest tests across seven files, including prior-schema upgrade, idempotent backfill,
  independent-installation restore, credential preservation, transaction rollback, optimistic
  concurrency, origin/authentication/reauthentication rejection, archive bounds, unsafe paths,
  unsupported versions/references, and PNG validation;
- production build;
- 104 Playwright checks across Chromium, installed Microsoft Edge, Firefox, and WebKit;
- both `npm run audit:production` and `npm run audit:all`: zero reported vulnerabilities.

Each browser project now has an independent temporary database and loopback test server. Earlier
combined runs exposed shared-fixture interference and intermittent stalled requests; the final
isolated-project run passed without retries. Tests cover selected serious/critical axe findings,
keyboard search, modal focus, narrow layouts, 200% CSS zoom, clipboard fallback, provider failure,
configuration download/restore preview, and cross-device note conflicts. This is not a claim of
complete accessibility conformance or hardware browser-zoom coverage.

**VERIFIED:** `docker build -t homelab-homepage-validation .` passed, including clean `npm ci`
for build and production dependencies. The final image passed a production startup/health smoke
with no network, a non-root user, read-only root filesystem, dropped capabilities,
no-new-privileges, and temporary memory-backed data. Public status returned 404 through simulated
trusted-proxy headers. The initial smoke inputs were corrected to satisfy existing proxy-trust and
setup-code validation; no production control was weakened.

**VERIFIED:** the optional Caddy image built locally; `caddy validate --adapter caddyfile` passed
with no network and dummy DNS-token input. `docker compose --env-file /dev/null -f
deploy/private-https/compose.yaml config --quiet` passed with documentation-only environment values.
Task-created image tags were removed after validation.

## Representative bookmark library

**VERIFIED:** a separate, real SQLite benchmark imported 5,000 generated links with folder paths:
preview 39.3 ms, transactional import 681.5 ms, snapshot read 45.6 ms, and HTML export 43.2 ms.
The serialized snapshot was about 1.54 MB. The disposable database was removed afterwards.

Browser measurements use a deterministic 5,000-link response fixture and the actual rendered
filter/pagination controls. The library renders 60 rows per page. These are single local
interaction measurements including automation overhead, not percentile or network-latency claims.

| Browser | Search/filter | Next page and scroll into view |
|---|---:|---:|
| chromium | 29.3 ms | 35.9 ms |
| edge | 28.4 ms | 49.3 ms |
| firefox | 27.3 ms | 108.6 ms |
| webkit | 32.1 ms | 84.4 ms |

## Implementation decisions and remaining rollout checks

- **VERIFIED:** uploaded backgrounds are bounded RGB/RGBA PNGs stored in SQLite. Database and
  asset replacement share one transaction, avoiding partial filesystem asset moves.
- **VERIFIED:** portable archives exclude credential values, administrator authentication,
  histories, deployment security settings, and environment-managed integrations. Restore retains
  destination authentication and disables restored monitoring/API widgets. Full disaster recovery
  still uses the operator runbook.
- **DECLARED:** trusted LAN/VPN HTTPS requires the chosen domain, scoped DNS token, private DNS,
  proxy addresses, VPN routing, and separately authorized deployment. Actual certificate issuance,
  renewal, LAN/VPN sign-in, and external-network isolation have not been tested here.
- **UNKNOWN:** actual Safari behavior remains unverified because its remote automation setting is
  disabled; WebKit passed. Brave is not installed, so its branded-browser smoke remains outstanding.
  No browser settings were changed to enable automation.
- **DECLARED:** publication-only Gitleaks/Trivy/ZAP/SBOM/signature workflow stages were not executed
  locally. They remain release gates; no image was published and no commit or push was made.
- **VERIFIED:** changes were reviewed against the saved pre-task tracked-file diff. Existing user
  changes remain in the working tree. The 50 optional ideas remain a review backlog rather than
  implementation commitments.

See [browser setup](BROWSER_HOME.md), [private HTTPS](PRIVATE_HTTPS.md),
[backup and recovery](BACKUP_AND_RESTORE.md), and the [optional backlog](HOMEPAGE_BACKLOG.md).
