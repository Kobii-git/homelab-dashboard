# Internal security model

Root `SECURITY.md` owns public vulnerability reporting. This file guides implementation and review.

## Deployment and threat model

The supported product is a private, single-admin LAN/VPN application. HTTPS behind an existing
reverse proxy is the normal deployment. An explicit direct HTTP mode supports initial setup on one
private host IP, with network-visible credentials/cookies until HTTPS is configured. Direct internet
exposure and multi-user authorization are unsupported. Production startup requires an exact
`APP_ORIGIN` and a strong cookie secret. HTTPS mode requires
trusted-proxy CIDRs; direct HTTP requires an exact private bind IP and disables proxy trust.

## Authentication and authorization

- Authentication is server-side and global for API routes except the explicit public set in
  `src/server/app.ts`. The setup/login/health/version categories are public; status API/page assets
  are public only when the deployment enables status mode.
- `ADMIN_PASSWORD` selects an environment-managed single credential. Otherwise the database stores
  one scrypt-hashed `AdminAccount`; legacy hashes are upgraded after successful verification.
- The `homelab_session` token is HMAC-signed, time-bounded, credential-bound, and checked against a
  database session version so password changes can invalidate active sessions.
- Sensitive connector, target, binding, and destructive mutations require the short-lived
  `homelab_reauth` token bound to the active session. The classifier lives in `src/server/app.ts`.
- Client-side visibility is never authorization. Any new API route is authenticated unless it is
  deliberately added to the explicit public set with negative tests.

## Browser and response controls

Production host/protocol enforcement binds requests to `APP_ORIGIN`. Browser mutations
enforce same-origin/fetch-site rules. Central hooks set CSP, frame, content-type, referrer,
permissions, cross-origin isolation/resource, cache, and HSTS headers in HTTPS mode. Central error
handling avoids returning internal exceptions for server failures.

Do not bypass these hooks, weaken headers, or add inline/script/network sources without a concrete
need and matching tests. Review login/setup rate limits and structured security records whenever
authentication behavior changes.

## Secrets and sensitive data

- Production cookie, OPNsense, optional AI-provider, registry/signing, and API-widget credential
  values belong in environment/repository secret stores, never committed files.
- API-widget records store only environment variable names and non-secret origin bindings. Direct
  database tampering must fail closed.
- Runtime diagnostics may report configuration state and safe hints, not secret values. Public
  health/version/status responses omit authenticated build identity and private target details.
- SQLite and its backups contain password hashes, service names/addresses, monitoring history,
  integration snapshots, and settings. Treat them as sensitive homelab security data.
- Non-production may persist an auto-generated cookie secret in `SystemConfig`; production requires
  the environment secret and removes the stored fallback.

## Outbound boundary

Admin-influenced destinations must use `src/server/outboundPolicy.ts` and pinned bounded request or
connectivity helpers. Admin-selected targets may use ordinary LAN, VPN, or public addresses. Preserve forbidden special ranges, DNS
timeouts, address pinning, fixed-provider allowlists/concurrency, redirect rejection/bounds,
response-size limits, timeouts, TLS verification, and sanitized errors.

Credentialed integrations require HTTPS and verified certificates unless the deployment explicitly
enables the surfaced emergency override. Private CAs should be installed through
`NODE_EXTRA_CA_CERTS`; disabling verification is not an ordinary fix.

## Security validation

Run the authentication/origin/outbound/redaction route cases relevant to any boundary change and
the full local gate before handoff. Container/workflow changes additionally require the CI scanner,
ZAP, hardened-container, SBOM/provenance, and signature controls described in `DEPLOYMENT.md`.
Suppressions must be finding-specific, narrowly scoped, justified, and reviewed; broad green-by-
suppression changes are forbidden.
