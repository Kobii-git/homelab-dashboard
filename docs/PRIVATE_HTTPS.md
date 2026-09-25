# Trusted HTTPS on LAN and VPN

The optional standalone deployment in `deploy/private-https/compose.yaml` supplies Caddy with a
Cloudflare DNS module. It does not publish the app or require inbound internet access. It is an
alternative to the existing root Compose deployment, not an override to combine with it.

## Prepare

1. Use a domain you own with authoritative DNS at Cloudflare. Your registrar can be elsewhere.
2. Choose a hostname such as `home.example.com`. Add a private DNS override pointing to the Docker
   host's private LAN address. Give VPN clients that DNS resolver and a route to the LAN address.
   Do not create public A/AAAA records pointing to your router, proxy the hostname through Cloudflare,
   enable Cloudflare Tunnel, or forward WAN ports.
3. Create a Cloudflare API token scoped to this one zone, with **Zone:DNS:Edit** and **Zone:Zone:Read**.
   Store it in a protected file outside the repository; set `CLOUDFLARE_TOKEN_FILE` to that path. The
   Compose secret is mounted only into Caddy. Ensure its container UID 1000 can read the file;
   do not make it world-readable. Local Compose secret files are not an encrypted secret store.
4. Copy the example variables to a protected operator environment file. Choose a non-overlapping
   Docker subnet and a fixed address inside it for Caddy. The application trusts only that address
   as a `/32`. Set `LAN_BIND_IP` to a private host interface, never `0.0.0.0` or a public address.
5. Set a verified application image digest and a random cookie secret.
   This example intentionally disables public status and AI. Add existing read-only connector
   environment settings explicitly if needed; do not put their secrets in configuration archives.

Caddy listens internally on unprivileged port 8443 and publishes only private-interface TCP 443.
The app has no published port. Firewall TCP 443 to the intended LAN/VPN clients. There is no HTTP
listener: use the explicit `https://` address when configuring browsers. Outgoing HTTPS and DNS
are needed for certificate issuance/renewal, Cloudflare validation, and enabled integrations.

## Validate before deploying

These commands are operator actions; they have not been run against a real deployment:

```sh
docker compose --env-file /secure/config/homepage.env -f deploy/private-https/compose.yaml config --quiet
docker compose --env-file /secure/config/homepage.env -f deploy/private-https/compose.yaml build proxy
```

Avoid printing expanded Compose configuration: it contains the cookie secret. Caddy and its builder
are pinned by image digest; the Cloudflare module is pinned by commit. Update and scan these pins
before subsequent deployments. Back up the existing application database before moving volumes.
This standalone project creates a new volume by default; it does not migrate an existing one.

After separately authorizing deployment, verify certificate trust, the expected hostname, login,
logout, and a harmless settings change from both LAN and VPN. With VPN disconnected on an external
network, the private hostname/application must not be reachable. Inspect router and firewall rules
rather than assuming private DNS alone prevents exposure.

## Renewal and recovery

Keep the proxy running and preserve its `caddy-data` and `caddy-config` volumes. Caddy renews managed
certificates automatically. Check expiry and renewal failures in proxy logs without printing tokens.
Use a disposable project and the Let's Encrypt staging issuer for renewal drills; staging certificates
are deliberately untrusted. Restore the production issuer afterwards. Do not delete live certificate
storage to test renewal or repeatedly force issuance against production rate limits.

Back up Caddy storage separately on encrypted media: it contains certificate private keys and ACME
account state and is excluded from application exports. On restore, preserve UID 1000 ownership,
restore the scoped token file, verify DNS/egress access, and repeat the LAN/VPN trust checks.
A revoked or expired DNS token prevents renewal; replace that proxy-only secret and restart the proxy.

DNS-01 validation permits private applications, but public certificate-transparency logs disclose
certificate hostnames. Pick a hostname that does not reveal sensitive inventory. Split DNS applies
to A/AAAA lookup; Caddy uses public resolvers to verify the public ACME TXT records.

Sources: [Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls),
[Cloudflare module permissions](https://github.com/caddy-dns/cloudflare),
[DNS validation](https://letsencrypt.org/docs/challenge-types/),
[certificate transparency](https://letsencrypt.org/docs/ct-logs/).
