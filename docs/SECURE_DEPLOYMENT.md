# Secure Deployment

## Required Topology

Run the dashboard only on a trusted LAN, VPN, or private mesh. The default Compose mapping
binds `127.0.0.1:4173`; an existing reverse proxy must be the only network-facing entry point.

The proxy must:

- serve the exact HTTPS value configured in `APP_ORIGIN`;
- preserve the original `Host`;
- set `X-Forwarded-Proto: https`;
- forward the client address;
- connect from an address listed in `TRUST_PROXY_CIDRS`.

Do not publish port 4173 on every interface. Private certificate authorities are supported
through `NODE_EXTRA_CA_CERTS`; install the CA rather than disabling verification.

## Required Configuration

Copy `.env.example` to an operator-owned environment file that is excluded from Git. At
minimum configure:

```env
APP_ORIGIN=https://dashboard.home.arpa
TRUST_PROXY_CIDRS=172.17.0.1/32
OUTBOUND_ALLOWED_CIDRS=10.0.21.0/24
COOKIE_SECRET=<at-least-32-random-characters>
SETUP_CODE=<12-base32-characters-for-first-boot>
REGISTRY_HOST=registry.home.arpa
```

The proxy CIDR shown above is only an example. Determine the exact source address that the
container observes for the host proxy; the application refuses production startup without
this boundary and rejects requests unless the trusted forwarded protocol is `https`.

`OUTBOUND_ALLOWED_CIDRS` is deliberately required. Use the smallest real network boundary;
`10.0.21.0/24` is an example, not an application default. Exact approved public monitoring
names may be listed in `OUTBOUND_ALLOWED_HOSTS`.

`SETUP_CODE` is required only until a database-backed administrator exists. Remove it from
the environment after setup. `PUBLIC_STATUS_MODE` defaults to `disabled`; `aggregate` exposes
counts only, and `services` additionally exposes service names and heartbeat history.

Credentialed integrations require HTTPS and certificate verification. The emergency
`ALLOW_INSECURE_INTEGRATIONS=true` override is reported as a critical Runtime Health warning
and is not acceptable for launch.

For a private CA, mount its PEM bundle into the container with a Compose override and set
`NODE_EXTRA_CA_CERTS` to that in-container path. The base Compose file passes the variable
through but does not assume an operator-specific certificate location.

## Forgejo, Registry, and Image Trust

Configure Forgejo Git access over SSH and the registry over trusted HTTPS. Set the repository
variable `REGISTRY_HOST` to the registry hostname without a URL scheme. Install a private CA
on Forgejo runners and Docker hosts when required, then rotate the token previously used over
HTTP.

Generate a Cosign key pair outside the repository:

```sh
cosign generate-key-pair
```

Store the private key and password as `COSIGN_PRIVATE_KEY` and `COSIGN_PASSWORD` secrets.
Store the public key as `COSIGN_PUBLIC_KEY`. Publish that public key as a repository download
or other authenticated, stable operator URL and record the URL in the deployment inventory.
The workflows sign the pushed digest and verify it before succeeding. Never commit the
private key.

The workflows also run npm audits, stale-copy checks, Gitleaks, Trivy filesystem/image
scans, SBOM generation, provenance attestation, browser tests, and unauthenticated plus
authenticated ZAP baselines.

## Launch Checklist

- Reverse-proxy HTTPS and Host/Origin validation are working.
- Runtime Health reports no security readiness warnings.
- Public status is disabled unless deliberately approved.
- Monitoring CIDRs and any exact public hosts are minimal and correct.
- All private CAs are trusted; insecure integration overrides are off.
- Forgejo Git uses SSH and the registry passes its HTTPS `/v2/` preflight.
- The Forgejo workflow is green and the Cosign signature verifies by digest.
- npm audit and the final Trivy image scan report zero vulnerabilities at the configured gate.
- The backup and restore drill in `BACKUP_AND_RESTORE.md` has succeeded.
