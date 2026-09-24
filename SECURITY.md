# Security policy

## Supported versions

Security fixes target the current `main` branch and newly published stable images. Historical tags
and the `beta` branch are not independently maintained security branches. Use a validated image
digest; version numbers alone do not identify every development build.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Kobii-git/homelab-dashboard/security/advisories/new)
when the repository's **Report a vulnerability** button is available. If it is not available, open
an issue asking for a private reporting channel without including vulnerability details. Maintainers
must enable and test private reporting before public launch.

Do not put exploit details, credentials, environment files, databases, configuration exports or
private network information in public issues or pull requests. Include the affected commit or image
digest, a minimal reproduction using synthetic data, impact and prerequisites in the private report.
Do not test systems or data you do not own or have permission to assess. Maintainers aim to acknowledge
reports within seven days; this volunteer project does not provide a response-time guarantee.

## Deployment boundary

Public source does not make this an internet-facing service. Homelab Dashboard is a private,
single-admin LAN/VPN application. Supported production deployments use an HTTPS reverse proxy,
explicit origin/proxy and outbound allowlists, trusted TLS, and protected external backups.
Direct internet exposure and multiple-user authorization are unsupported.

See [secure deployment](docs/SECURE_DEPLOYMENT.md), [privacy](PRIVACY.md), and
[backup and recovery](docs/BACKUP_AND_RESTORE.md).
