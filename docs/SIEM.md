# Authentication events to a SIEM

Configure **Settings → Integrations & system → Security events** after signing in. The app can send the same authentication events to a Wazuh manager and a Microsoft Sentinel syslog forwarder independently. Changing destinations and sending a test event require recent password confirmation.

The app sends one RFC 3164 syslog line per event over TCP. Wazuh uses plain TCP. The Sentinel destination can use plain TCP or certificate-verified TLS. Use plain TCP only across a trusted LAN or VPN; install a private CA with `NODE_EXTRA_CA_CERTS` if using TLS. Destination names are resolved through the app's outbound policy and each connection uses the approved IP address. The target host and port are stored as non-secret `SystemConfig` settings, excluded from portable configuration exports. They remain in full database backups.

Events cover successful and failed sign-ins, password confirmations, explicit sign-outs, and password changes. Failed sign-ins include bad credentials, malformed requests, and rate-limited attempts. Stateless session expiration does not produce a sign-out event. Each JSON payload has `id`, `timestamp` (UTC), `product`, `event`, `result`, `account` (the targeted single-admin account), and `clientIp`; password and session values are excluded. `auth.login`, `auth.reauthenticate`, `auth.logout`, and `auth.password_change` are the current event names. A manual test sends `siem.test`. The syslog facility is `local0`, with informational severity for success and warning severity for failure.

Delivery uses a bounded in-memory queue and short timeouts so a disconnected SIEM cannot delay sign-in. The settings page shows sent, failed, and dropped counts for the current app process. It does not guarantee delivery, retry failed events, or retain the queue across restarts. Keep ordinary application structured logs if you need an independent record.

## Wazuh manager

Enable a TCP syslog listener on the Wazuh server and allow the dashboard's source IP. For example, add a `<remote>` block with `<connection>syslog</connection>`, `<protocol>tcp</protocol>`, the chosen `<port>`, and mandatory `<allowed-ips>` to the manager configuration. Follow [Wazuh's syslog receiver procedure](https://documentation.wazuh.com/current/user-manual/capabilities/log-data-collection/syslog.html) for the full configuration and restart. Enter that host and port under **Wazuh manager**, then send a test event.

Wazuh has a built-in JSON decoder. Use `wazuh-logtest` with a received line to confirm field extraction, then add a local rule for the event and result fields if you want alerts. See [JSON decoding](https://documentation.wazuh.com/current/user-manual/ruleset/decoders/json-decoder.html) and [custom rule syntax](https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html). Receiving a syslog line alone does not establish that a Wazuh alert rule matched.

## Microsoft Sentinel via Syslog

Set up a Linux syslog forwarder with rsyslog or syslog-ng and the **Syslog via AMA** connector. Create a data collection rule that includes `local0` at **Informational** severity so both successes and failures are retained, then configure the forwarder to listen on the selected TCP or TLS port. Enter the forwarder's host and port under **Microsoft Sentinel syslog forwarder**. The app does not send directly to the Sentinel cloud endpoint. See [Microsoft's Syslog via AMA setup](https://learn.microsoft.com/en-us/azure/sentinel/connect-cef-syslog-ama).

This starter KQL query extracts authentication events for a custom analytic rule:

```kusto
Syslog
| where SyslogMessage contains '"product":"homelab-dashboard"'
| extend payload = parse_json(substring(SyslogMessage, indexof(SyslogMessage, "{")))
| where tostring(payload.event) startswith "auth."
| project TimeGenerated, event=tostring(payload.event), result=tostring(payload.result),
          clientIp=tostring(payload.clientIp), eventId=tostring(payload.id), Computer
```

Inspect the received `SyslogMessage` and adjust the query for your forwarder's parsing. The [Syslog table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/syslog) describes the available columns. A successful test send only confirms the TCP/TLS write; confirm ingestion and analytic rule results in the SIEM.

For a demo analytic, add a scheduled query rule that finds repeated failed sign-ins:

```kusto
Syslog
| where SyslogMessage contains '"product":"homelab-dashboard"'
| extend payload = parse_json(substring(SyslogMessage, indexof(SyslogMessage, "{")))
| where tostring(payload.event) == "auth.login" and tostring(payload.result) == "failure"
| summarize failures=count() by clientIp=tostring(payload.clientIp), bin(TimeGenerated, 5m)
| where failures >= 3
```
