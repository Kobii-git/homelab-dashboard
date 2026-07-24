# SQLite Backup and Restore Runbook

Backups are an operator responsibility and are intentionally outside the application API.
Keep them on encrypted storage separate from the Docker host.

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
