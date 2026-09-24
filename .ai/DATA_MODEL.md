# Persistent data

## Storage and ownership

Prisma over SQLite is the only application datastore. `prisma/schema.prisma` is authoritative; do
not maintain a parallel model inventory here. Docker stores the database under the `/data` volume.
The single administrator owns all catalog, monitoring, integration, and configuration state; there
is no tenant or per-user isolation model.

The schema groups state into:

- dashboard groups and service resources;
- health checks and bounded result history;
- host-monitor definitions and samples;
- integration sources and normalized samples;
- read-only API-widget definitions and samples;
- explicit service/bookmark purpose and bookmark workspace/collection/reading/trash metadata;
- a versioned homepage JSON document, atomic configuration revision, and bounded PNG asset blobs;
- the administrator credential record;
- versioned/non-secret runtime settings (including fixed-order home-module toggles/widget IDs) and
  internal migration/binding markers in `SystemConfig`.

Relations use cascading or set-null deletion where defined by the schema. Route tests, not UI
confirmation alone, must establish destructive behavior.

## Schema and compatibility

Local and container startup use Prisma `db push`; there is no committed versioned migration
history. Startup backfills in `src/server/app.ts` use `SystemConfig` markers for selected data-shape
transitions. This is an accepted current limitation tracked in `KNOWN_RISKS.md`, not a pattern to
extend casually.

For any schema or stored JSON change:

- prove fresh creation and upgrade/backfill on disposable databases;
- preserve existing rows and relationships unless destructive loss is explicitly approved;
- keep backfills idempotent and distinguish an absent marker from partial completion;
- document inability to downgrade or roll back;
- do not use `--accept-data-loss` to make a check pass;
- review the external backup/restore runbook before release.

## Sensitive and derived data

The database contains sensitive network inventory, password hashes, service metadata, health and
host history, normalized integration snapshots, and settings. OPNsense/TrueNAS/API-widget/AI credential
values must not be stored. API-widget credential bindings are non-secret but security-critical and
must fail closed if records are changed outside the application.

Calendar events, Todoist tasks, Gmail counts, Plex/Radarr metadata, TMDB discovery, access tokens,
and poster references are in-memory only. TrueNAS pool/dataset capacity and health are operational
signals and use the existing `IntegrationSource`/`IntegrationSample` JSON fields; no dedicated
personal-data table or Prisma schema change is permitted for the home summary.

Health, host, integration, and widget sample histories are bounded by source-owned retention
constants and transactionally pruned after sampling. Do not copy numeric limits into new documents;
change the source constant and its tests together.

## Backup, restore, deletion, and recovery

Portable configuration export/restore is authenticated and reauthentication-gated; it uses an explicit
allowlist and atomic SQLite replacement, excludes credentials/security state, and disables restored
monitoring. Full database backups/restores remain operator-managed using `docs/BACKUP_AND_RESTORE.md`;
there is no backup scheduler or full-database restore API. A database backup includes the state above and may expose
private topology and password hashes. Encryption, off-host retention, integrity checking, and
restore drills are deployment responsibilities.

Never rehearse restore, destructive schema work, seed, or cleanup on real/operator data. Use an
explicit disposable path and retain a pre-change safety copy for any separately authorized real
maintenance operation.

## Homepage configuration revisions

`initializeHomepage` installs SQLite triggers for portable configuration columns and allowlisted
settings. They increment `HomepageState.revision` in the same transaction as legacy/new writes;
telemetry updates are excluded. Homepage editors compare expected revisions transactionally and
return 409 on stale writes. Background assets are stored in SQLite so restore cannot partially apply
filesystem changes. The one-time bookmark backfill preserves resource IDs, groups and history.
