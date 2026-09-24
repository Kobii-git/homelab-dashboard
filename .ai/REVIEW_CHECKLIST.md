# Diff-triggered review checklist

Use only the sections activated by the diff. Read the request and actual diff; do not rely on an
implementation summary or manufacture findings.

## Always

- Is the change the smallest coherent solution, with pre-existing user work preserved?
- Do source, tests, configuration, and durable documentation agree?
- Are validation claims tied to exact commands and observed results?
- Did the diff introduce secrets, private topology/data, generated artifacts, broad suppressions,
  or weakened controls?
- Are compatibility, failure behavior, cleanup, and rollback/recovery proportional to risk?

## `src/client/**` or shared DTOs

- Check loading, empty, error, authentication-expiry, and narrow-viewport states.
- Check keyboard navigation, focus behavior, semantics, announcements, reduced motion, and contrast.
- Confirm shared/client/server shapes change together and stale responses fail safely.

## Routes, validation, or public status

- Confirm Zod validation and centralized error behavior.
- Confirm the global authentication/public-route hook covers the route; test negative access.
- For public output, verify disabled/aggregate/detail modes and absence of IDs, targets, secrets,
  authenticated build identity, and internal errors.
- For mutations, verify same-origin enforcement and recent reauthentication classification.

## Authentication, setup, sessions, or rate limiting

- Check timing-safe comparisons, password hashing/legacy upgrade, cookie attributes, expiry,
  credential/session-version binding, logout/password invalidation, and setup-code lifecycle.
- Test invalid, expired, cross-session, wrong-origin, and rate-limited cases.

## Outbound network or integrations

- Confirm the destination uses shared DNS/allowlist/pinning controls and cannot follow an unchecked
  redirect or reconnect to another address.
- Check bounded timeout, response size, concurrency/retry behavior, TLS verification, and sanitized
  errors/logs.
- Confirm credentials remain environment-only and bound to the intended verified origin.
- Confirm remote failure cannot block the core dashboard.

## Prisma, retention, seed, or stored configuration

- Test fresh and existing disposable databases; check idempotent backfill and partial-failure safety.
- Review relationships, unique/integrity assumptions, cascades, retention pruning, and transaction
  boundaries.
- Check backup/restore completeness and rollback limitations; reject real-data validation.

## Docker, Compose, or environment

- Compare code parsing, `.env.example`, Compose mapping, docs, and runtime diagnostics.
- Preserve non-root/read-only operation, `/data` ownership, tmpfs, dropped capabilities,
  no-new-privileges, loopback binding, health check, and sensitive build-context exclusions.
- Check exact HTTPS origin/proxy/outbound boundaries and private-CA handling.

## CI, dependencies, or release metadata

- Confirm lockfile/runtime alignment and run both audits for dependency changes.
- Check least-privilege permissions, immutable action/image pins, gate ordering, canonical-workflow
  coverage, registry TLS, SBOM/provenance, pushed-digest scan, and signing verification.
- Confirm `package.json` remains the version source and no commit, tag, image push, release, or
  deployment occurred without explicit authorization.
