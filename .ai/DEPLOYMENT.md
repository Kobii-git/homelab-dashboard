# Deployment and release topology

## Supported runtime

The normal production shape is the prebuilt Docker image run by `docker-compose.yml`, bound to
loopback on port 4173 and reached through an existing HTTPS reverse proxy. The application does not
terminate production TLS. Initial private LAN setup may opt into direct HTTP bound to one private
host IP; credentials and cookies are then unencrypted in transit. Local development runs Fastify on
4173 and Vite on 5173.

The runtime image:

- uses the pinned Node 22 Alpine base;
- runs as the unprivileged `node` user;
- writes durable SQLite state only to `/data`;
- supports a read-only root filesystem and bounded `/tmp` tmpfs;
- drops Linux capabilities and enables `no-new-privileges` in Compose;
- exposes an HTTP liveness health check at `/api/health`;
- applies the Prisma schema before starting the compiled server.

`.dockerignore` must continue excluding Git metadata, dependencies/build output, databases,
environment files, reports, backups, logs, and private tooling context from the build context.

## Configuration and secrets

`.env.example` owns safe variable names/placeholders. `src/server/env.ts` owns parsing and production
startup requirements. `docker-compose.yml` owns the deployed environment mapping and hardening.
`docs/SECURE_DEPLOYMENT.md` owns the operator launch checklist, reverse-proxy requirements, private
CA guidance, and image-trust procedure.
`scripts/install-docker.sh` configures a local source build, generating missing first-boot secrets
without replacing existing nonempty values. The default first-run path asks for a private bind IP;
`--https-proxy` switches to an HTTPS origin and trusted proxy CIDR. The Compose build override
retains the production hardening.

Configuration changes must be reconciled across those sources. Never bake secret values or a real
network boundary into an image, Compose file, example, or AI document.

## Upgrade, rollback, and recovery

The named volume survives image/container replacement. Operators must create and verify a backup
before schema-affecting upgrades. Runtime `db push` has no down-migration path; image rollback may
not roll data back. Follow `docs/BACKUP_AND_RESTORE.md` for recovery and rehearse only on disposable
data unless a real maintenance operation is separately authorized.

Liveness proves the HTTP process responds; it does not prove every configured integration or
scheduler is healthy. Authenticated Runtime Health provides the richer operational view.

## CI, publication, and channels

`.github/workflows/docker.yml` is the canonical publication workflow. The stable and beta branches map to their documented image channels.
The workflow validates, scans, builds, smoke-tests, generates SBOM/provenance, scans the pushed digest,
and signs/verifies it with its GitHub OIDC identity before success.

Privileged actions and scanner images are pinned to immutable revisions/digests. Publishing uses GHCR, the job-scoped GitHub token, and OIDC; no legacy registry variable or
long-lived signing secret is required. Validation uses a read-only job; a dependent job holds publishing/OIDC permissions. Local implementation work must not push images, sign releases, create
tags, or deploy without explicit separate authorization.

The optional standalone `deploy/private-https/compose.yaml` supplies a pinned Caddy DNS-01 proxy.
It binds HTTPS to an explicitly configured private host address, publishes no app port, and keeps the
DNS token proxy-only. `docs/PRIVATE_HTTPS.md` owns this alternative deployment and renewal procedure.
