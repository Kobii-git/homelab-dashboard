# Configuration and full database backups

## Portable configuration in the app

**Settings → Data & backups** exports a versioned ZIP with workspaces, bookmarks, collections, reading
states, notes, prompt templates, layouts, PNG backgrounds, service/check definitions, host/API widget
definitions, and allowlisted utility/home preferences. Environment-variable names may be listed as
requirements; values, credential bindings, authentication, operational history, and deployment/network
security settings are excluded. Environment-managed integrations remain configured on the destination
server; recreate their environment configuration separately when moving to a new server.

To restore, upload the ZIP, review counts and warnings, download the current configuration, verify the
saved file, and confirm replacement. Export and restore require recent password verification. Previews
and safety-download tokens expire after ten minutes, are tied to the login session and configuration
revision, and do not survive restart. Any intervening configuration change requires a new preview and
backup. Upload and validation do not contact imported destinations.

Replacement removes prior portable definitions and their derived monitoring history. Administrator
credentials, sessions, server security settings, and environment-managed integrations remain intact.
Restored services/checks/hosts/API widgets start disabled; API-widget credential bindings are cleared.
Review destinations against the existing outbound policy and explicitly re-enable/rebind connections.
The archive is limited to 32 MiB with an 8 MiB manifest; each PNG is limited to 4 MiB.
V1 restore accepts original, uncompressed STORE-format exports only. Do not recompress or edit the ZIP.
Compressed, encrypted, ZIP64, overlapping, truncated, or checksum-invalid entries are rejected.
Datastore and asset changes share one SQLite transaction, including rollback on failure. Assets are
stored inside SQLite, so there are no filesystem asset moves that could partially commit.

This archive contains private content and is not a full disaster-recovery backup. It is not encrypted
by the app. Save it on protected/encrypted storage outside the server. There is no scheduled-backup
service or full-database restore API. An application configuration export cannot recover passwords,
monitoring history, certificates, environment files, or VPN/DNS settings.

Saved-note lists are included alongside the original scratchpad text. Older archives without a
saved-note list remain readable. Application versions from before saved-note lists were added reject
the new workspace field; keep a pre-upgrade database backup if a downgrade is needed. Do not
remove that field manually, as it contains saved notes.

Layouts also include each section's always-open/dropdown choice. Older archives default to always
open. Versions without this layout field reject new archives, so use a pre-upgrade backup when
rolling back to an older application version.

## Full disaster recovery

Full database backups remain an operator responsibility. Keep them on encrypted storage separate
from the Docker host. The SQLite backup now also includes uploaded homepage assets.

## Backup

The simplest consistent named-volume backup briefly stops the single application writer:

```sh
mkdir -p backups
docker compose stop dashboard
docker cp homelab-dashboard:/data/homelab.db "./backups/homelab-$(date -u +%Y%m%dT%H%M%SZ).db"
docker compose start dashboard
```

Confirm the container is healthy and validate the copied database with a trusted SQLite
client using `PRAGMA integrity_check;`. Encrypt each backup before copying it off-host. For
example, an operator-managed [age](https://age-encryption.org/) recipient can be used without
placing a decryption key on the dashboard host:

```sh
age --recipient 'age1REPLACE_WITH_OPERATOR_RECIPIENT' \
  --output ./backups/homelab-current.db.age ./backups/homelab-current.db
```

Keep the age identity in the recovery system or password manager, not beside the backup.
Verify a sample decryption and `PRAGMA integrity_check;` before deleting any plaintext
working copy.

Recommended minimum retention is seven daily, four weekly, and three monthly backups. Run a
backup before every image or schema upgrade. Monitor the scheduler exit code and backup age;
do not treat an existing file as proof that a backup is usable.

Schedule an operator-owned wrapper for the stop/copy/start/integrity/encrypt/upload sequence
with a systemd timer, cron, or the existing backup platform. Use a lock (`flock` on Linux) so
scheduled and pre-upgrade backups cannot overlap, alert on any failed command, and prune only
encrypted off-host copies after the retention policy has been confirmed. The application
does not contain a backup scheduler.

## Restore Drill

Use a disposable Compose project or maintenance window:

```sh
docker compose stop dashboard
docker cp homelab-dashboard:/data/homelab.db ./backups/pre-restore-safety-copy.db
docker cp ./backups/known-good.db homelab-dashboard:/data/homelab.db
docker compose run --rm --no-deps --user root --entrypoint sh dashboard \
  -c 'chown node:node /data/homelab.db && chmod 600 /data/homelab.db'
docker compose start dashboard
```

After restoration, verify login, Dashboard settings, service/group ordering, monitoring
history, API-widget configuration, and Launchpad utility configuration. Run
`PRAGMA integrity_check;` again. Keep the pre-restore copy until the restored deployment has
been observed successfully.

Test this procedure at least quarterly and whenever the image, database tooling, volume name,
or deployment user changes.
