# Secure Deployment

## Required Topology

Run the dashboard only on a trusted LAN, VPN, or private mesh. The default Compose mapping
binds `127.0.0.1:4173`; an existing reverse proxy is the normal network-facing entry point.
For initial setup without a proxy, the installer offers direct HTTP on one private IPv4 address.
In that mode, login credentials and session cookies cross the network without encryption. Keep the
port restricted to your trusted network and never forward it to the internet.

The proxy must:

- serve the exact HTTPS value configured in `APP_ORIGIN`;
- preserve the original `Host`;
- set `X-Forwarded-Proto: https`;
- forward the client address;
- connect from an address listed in `TRUST_PROXY_CIDRS`.

Do not publish port 4173 on every interface. Private certificate authorities are supported
through `NODE_EXTRA_CA_CERTS`; install the CA rather than disabling verification.

## Required Configuration

From a fresh clone, run `./scripts/install-docker.sh`. With the example `.env`, it prompts for
the Docker host's private IPv4 address and monitoring boundary, then generates secrets and builds
the image locally. Run `./scripts/install-docker.sh --https-proxy` when the proxy is ready; it asks
for the exact HTTPS origin and proxy CIDR, switches the bind back to loopback, and keeps the data
volume.
Run it with `--configure-only` to write configuration and check Compose without starting a
container. It preserves existing nonempty secrets in `.env` and does not recreate a cleared setup
code after initial configuration; keep that file owner-readable and
outside Git. For a manually managed deployment, copy `.env.example` to `.env` and at minimum
configure:

```env
APP_ORIGIN=https://dashboard.home.arpa
TRUST_PROXY_CIDRS=172.17.0.1/32
OUTBOUND_ALLOWED_CIDRS=192.168.50.0/24
COOKIE_SECRET=<at-least-32-random-characters>
SETUP_CODE=<12-base32-characters-for-first-boot>
HOMELAB_IMAGE=ghcr.io/kobii-git/homelab-dashboard@sha256:<verified-digest>
```

The proxy CIDR shown above is only an example for HTTPS mode. Determine the exact source address that the
container observes for the host proxy; the application refuses production startup without
this boundary in HTTPS mode and rejects requests unless the trusted forwarded protocol is `https`.
Direct HTTP mode requires `DIRECT_HTTP_LAN=true`, `APP_ORIGIN=http://<private-host-IP>:4173`,
`DASHBOARD_BIND_IP=<same-private-host-IP>`, and an empty `TRUST_PROXY_CIDRS`. The server rejects
public bind addresses and mismatched origins.

`OUTBOUND_ALLOWED_CIDRS` is deliberately required. Use the smallest real network boundary;
`192.168.50.0/24` is an example, not an application default. Exact approved public monitoring
names may be listed in `OUTBOUND_ALLOWED_HOSTS`.

`SETUP_CODE` is required only until a database-backed administrator exists. Clear it in
`.env` after setup. `PUBLIC_STATUS_MODE` defaults to `disabled`; `aggregate` exposes
counts only, and `services` additionally exposes service names and heartbeat history.

Credentialed integrations require HTTPS and certificate verification. The emergency
`ALLOW_INSECURE_INTEGRATIONS=true` override is reported as a critical Runtime Health warning
and is not acceptable for launch.

Google, Todoist, TMDB, Plex, Radarr, and TrueNAS credentials belong only in the operator-owned
environment. Use a Google refresh token limited to Calendar events and Gmail labels, a read-only
TMDB token, and least-privileged service accounts for media/storage systems. TrueNAS requires WSS;
grant only the permissions needed for `pool.query` and `pool.dataset.query`. Do not place API keys
in SQLite, screenshots, logs, Compose files committed to Git, or the custom widget field mappings.

For a private CA, mount its PEM bundle into the container with a Compose override and set
`NODE_EXTRA_CA_CERTS` to that in-container path. The base Compose file passes the variable
through but does not assume an operator-specific certificate location.

## GitHub, Registry, and Image Trust

GitHub is the canonical repository and GHCR is the image registry. Use authenticated GitHub
HTTPS/SSH and `docker login ghcr.io` with a token limited to reading packages on deployment hosts.
A public source repository does not expose a running instance. Package visibility is a separate
release decision; private packages require package-read credentials. See [GitHub operations](../GITHUB.md).

The publishing workflow uses its short-lived GitHub token for GHCR and OIDC identity for Cosign.
It signs the pushed digest and verifies the exact workflow identity and GitHub issuer before
succeeding; there is no stored signing private key to migrate. Verify both identity and issuer on
operator machines, then deploy the digest. Sigstore's transparency log records signing metadata
(including the repository/workflow identity and image digest); application configuration is excluded.

The workflows also run npm audits, stale-copy checks, Gitleaks, Trivy filesystem/image
scans, SBOM generation, provenance attestation, browser tests, and unauthenticated plus
authenticated ZAP baselines.

## Launch Checklist

- Reverse-proxy HTTPS and Host/Origin validation are working.
- Runtime Health reports no security readiness warnings.
- Public status is disabled unless deliberately approved.
- Monitoring CIDRs and any exact public hosts are minimal and correct.
- All private CAs are trusted; insecure integration overrides are off.
- Personal-context and media modules show only expected safe fields; TrueNAS uses a read-only role.
- GitHub access and private GHCR pulls work over authenticated, trusted transports.
- The GitHub workflow is green and the Cosign signature verifies by digest and exact workflow identity.
- npm audit and the final Trivy image scan report zero vulnerabilities at the configured gate.
- The backup and restore drill in `BACKUP_AND_RESTORE.md` has succeeded.
