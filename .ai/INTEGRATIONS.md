# Outbound integrations

All integrations are read-only signals or launch utilities. Mutating arbitrary remote APIs,
firewall changes, executable widgets, discovery, and AI control actions are outside the product
boundary.

| Integration | Configuration/credentials | Network and failure boundary |
|---|---|---|
| Health checks | Admin-defined HTTP, TCP, ping, or SSL targets; no stored target credential feature | Shared destination policy, DNS/address pinning, strict TLS, explicit timeouts, bounded results; failures become sanitized status. |
| Glances host metrics | Admin-defined base URL; v1 has no Glances credentials | Shared outbound policy and bounded JSON; polling failure is stored without blocking dashboard access. |
| OPNsense | Environment-only base URL, API key/secret, TLS and interval settings | One configured firewall; allowlisted read endpoints only; credentialed HTTPS; normalized snapshots/samples; imports require admin confirmation. |
| Google Calendar/Gmail | Environment-only OAuth client, secret, refresh token, and calendar IDs | Fixed Google hosts; Calendar event metadata and Inbox unread count only; five-minute in-memory cache; never persisted or included in status/AI evidence. |
| Todoist | Environment-only personal API token | Fixed Todoist host; bounded `today \| overdue` pagination; at most six normalized links; two-minute in-memory cache. |
| Plex/Radarr | Existing credential-bound API widgets selected by non-secret home config | Private-network policy; read-only recently-added/calendar endpoints; two-minute in-memory cache; poster bytes use opaque same-origin references. |
| TMDB | Environment-only bearer token plus non-secret region/language | Fixed API/image hosts; upcoming and daily trending movies; six-hour cache; required attribution in Admin Credits. |
| TrueNAS SCALE 25.04+ | Environment-only HTTPS origin, username, API key, pool/dataset, TLS and interval settings | Bounded WSS JSON-RPC with DNS/address pinning; `pool.query`/`pool.dataset.query` only; 1,440 persisted operational samples; storage data excluded from public status and AI evidence. |
| API widgets | Definition in SQLite; secret value read from an allowed environment-variable name | Read-only JSON GET, bounded request, supported auth adapters, credential-origin binding, recent reauth for sensitive changes, sanitized failures. |
| AI Command Briefing | Environment-only OpenAI-compatible endpoint, model, optional key, TLS and redaction settings | Authenticated summary only; evidence is sanitized and targets are excluded by default; bounded request; cached result/failure does not block core dashboard. |
| Weather/releases | Non-secret settings in `SystemConfig` | Fixed Open-Meteo/GitHub hosts, concurrency/time/size bounds, caching, stale fallback, and separate dashboard request path. |
| Service icons | Catalog slug or approved service favicon | Fixed catalog allowlist or shared outbound policy, byte/content validation, same-origin proxy, initials fallback. |

## Shared requirements

- Admin-defined destinations pass `src/server/outboundPolicy.ts`; HTTP JSON uses
  `src/server/httpJson.ts` or an equally bounded pinned helper.
- Fixed providers must be added to an explicit source allowlist with a documented data-disclosure
  reason, concurrency/timeout/size limits, and failure tests.
- Redirects must not escape destination validation. DNS resolution and the actual connection must
  remain bound to the approved address.
- Credential values never enter SQLite, diagnostics, logs, public status, fixtures, or committed
  documentation. API-widget records may store only allowed variable names and verified origin
  bindings.
- Verified HTTPS is the default for credentials. Use a trusted private CA; the insecure-integration
  switch is an explicit emergency deployment exception surfaced by Runtime Health.
- Retry behavior must be bounded and safe for the operation. Current integrations are read-only;
  do not introduce write retries under this abstraction.
- Provider or target failure degrades only its own cached/status surface and must not prevent login,
  service launch, or the core dashboard from loading.

## Test method

Use local fake HTTP/TCP/TLS servers and injected requesters. Cover success, auth construction without
secret exposure, forbidden-address rejection, DNS/redirect/rebinding, timeout, size limits, malformed JSON,
TLS trust/hostname errors, persisted sanitized failure, and dashboard isolation. Never validate by
contacting an operator or production service.
