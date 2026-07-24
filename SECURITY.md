# Security Policy

## Supported Releases

Security fixes are applied to the current release line only. Check `package.json` and the
authenticated Runtime Health panel for the running version.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Email `kobus@kobii.dev` with:

- the affected version or image digest;
- a concise reproduction;
- the expected impact;
- whether any credentials or private homelab data may have been exposed.

Do not access systems or data that are not yours. Acknowledgement is normally sent within
seven days. Fix timing depends on severity and reproducibility.

## Deployment Boundary

Homelab Dashboard is a private, single-admin LAN/VPN application. Supported production
deployments use an HTTPS reverse proxy, an explicit outbound CIDR allowlist, a TLS-enabled
container registry, and external SQLite backups. Direct internet exposure is unsupported.

See [Secure Deployment](docs/SECURE_DEPLOYMENT.md) before launch.
