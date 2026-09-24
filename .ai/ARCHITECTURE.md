# Architecture

The human-facing product boundary and feature overview live in `README.md`. This document maps code
responsibilities and trust boundaries for implementation work.

## Runtime components

- `src/client/main.tsx` starts the React SPA. `src/client/App.tsx` owns setup/authentication state,
  top-level data loading, navigation, and view selection. Feature views live under
  `src/client/features/`; shared UI and client helpers live under `src/client/components/` and
  `src/client/lib/`.
- `src/server/index.ts` loads validated environment configuration, opens Prisma, resolves the
  runtime cookie secret, creates the Fastify app, and listens on the configured address.
- `src/server/app.ts` is the composition root. It installs security/authentication hooks, registers
  most API routes, performs bounded startup backfills, wires schedulers, and serves the built SPA.
- `src/server/routes/` holds extracted route modules. New route modules must receive dependencies
  explicitly rather than creating hidden global clients.
- `src/server/healthChecks.ts`, `metrics.ts`, `opnsense.ts`, `truenas.ts`, `apiWidgets.ts`, and `aiBriefing.ts`
  implement polling/scheduling domains. `dashboardUtilities.ts` handles fixed-provider Launchpad
  utilities; `homeContext.ts` isolates authenticated calendar, task, mail, media, poster, and
  storage-summary reads.
- `src/server/homepage.ts` owns explicit bookmarks, workspace content, inert browser import, and
  transactional configuration revisions. `homepageBackup.ts` handles allowlisted configuration
  archives and bounded PNG assets, stored in SQLite for atomic replacement.
- `src/client/features/homepage/` owns the everyday Home/Work experience, Google submission,
  ordinary ChatGPT links, local draft protection, and configuration backup controls.
- `src/server/outboundPolicy.ts`, `httpJson.ts`, `connectivity.ts`, and `iconProxy.ts` form the
  outbound-network boundary. Do not bypass them for convenience.
- `src/shared/` owns DTOs and build/version values shared across client and server.
- `prisma/schema.prisma` is the authoritative persistent schema. SQLite is the only supported data
  store.

## Request and data flow

The browser calls the same-origin Fastify API. A global request hook validates production
host/transport, mutation origin, the explicit public-route set, and the signed admin session before
handlers run. Sensitive target, connector, secret-binding, and destructive changes additionally
pass the recent-reauthentication pre-handler.

Fastify handlers validate input with Zod, read/write through Prisma, and return shared DTO shapes.
Background schedulers run due health, host, OPNsense, TrueNAS, API-widget, and optional AI-briefing work. The
dashboard endpoint assembles persisted state and cached samples; fixed-provider weather/release data
and authenticated home context are fetched separately so provider failure does not block the core dashboard.

## Trust boundaries

- **Browser to API:** same-origin cookies and server-side authorization are authoritative; client
  controls are usability only.
- **Reverse proxy to app:** production trusts only configured proxy CIDRs and an exact HTTPS origin.
- **Admin-defined target to network:** DNS resolution, forbidden ranges, explicit outbound
  allowlists, connection pinning, and bounded responses constrain SSRF and rebinding.
- **Credential to integration:** OPNsense, TrueNAS, personal-context, AI, and API-widget secrets originate in environment
  configuration. Credentialed endpoints require verified HTTPS unless an explicitly surfaced
  emergency override is enabled.
- **Application to SQLite:** `/data` is durable state in Docker. The root filesystem is intended to
  remain read-only.
- **Optional public status:** public exposure is deployment opt-in and must not inherit authenticated
  DTOs or build/runtime detail.

## High-blast-radius areas

- Global hooks and route classification in `src/server/app.ts`.
- Session/password/setup code in `src/server/auth.ts` and `src/server/env.ts`.
- Destination validation and connection pinning in the outbound boundary modules.
- Prisma schema, startup backfills, `SystemConfig` formats, and retention deletion.
- Docker/Compose security settings and both publishing workflows.
- Shared DTO changes consumed by the SPA, tests, and public-status serialization.

## Product overlay

This is deliberately one trusted administrator on a private LAN/VPN, not a general multi-tenant or
remote-management platform. The README owns the complete in-scope/out-of-scope statement. Expanding
that boundary is a product and threat-model decision, not an incidental implementation choice.
