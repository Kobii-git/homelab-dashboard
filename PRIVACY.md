# Privacy and data handling

Homelab Dashboard is self-hosted by one administrator. The project does not operate a hosted account
or synchronization service. Browsers synchronize by contacting the same server. Publishing this
source does not publish your installation or its data.

## Local storage

SQLite holds bookmarks, notes, prompt templates, layouts, uploaded backgrounds, service definitions,
operational samples and the database-managed administrator password hash. Production session-signing
and integration secrets come from the operator environment. Development mode can store a generated
session-signing secret in SQLite. Full backups must therefore be treated as sensitive.

The browser holds session/reauthentication cookies and local presentation preferences, workspace
selection and focus-timer state. Unsaved drafts stay in the current browser. Clearing browser site
data removes local state but does not remove server data. Logout/password changes invalidate all
admin sessions. Trash retains bookmarks until explicitly deleted; backups can retain deleted content.
Monitoring histories are pruned by the limits in source; no automatic deletion of operator backups is
provided. Configuration exports contain private content and are not encrypted by the app.

## External requests

There is no analytics or crash-reporting SDK in the reviewed application. Optional features still
contact external services. Operators control which integrations are enabled and their credentials.
External providers can observe the requesting server's IP, request content and timing.

| Feature | Data leaving the installation |
|---|---|
| Google or another explicit web search | Submitted query goes from the browser to the selected provider; partial queries are not sent for suggestions. |
| ChatGPT and bookmark links | Opening a link uses the ordinary website and its cookies/privacy policy. Prompt copying is local; sending text is a separate user action. |
| Open-Meteo | Location searches, selected coordinates and units; forecasts are cached locally. |
| GitHub release widget | Configured public repository identifiers; no installation database is uploaded. |
| Service icons | Requested icon slug through the fixed catalog/CDN, or an approved favicon request to the selected service. |
| Google Calendar/Gmail and Todoist | Configured credentials/token refresh and read queries; event/task summaries and unread counts are cached in memory. |
| TMDB and media | Region/language and media requests to the configured provider; posters use the server proxy. |
| Homelab integrations | Read-only requests to configured services under the outbound policy. Authentication exchanges can use POST even when application operations are read-only. |
| Optional AI operations briefing | Selected monitoring names, statuses and statistics go to the configured model provider. Disabled unless configured. With `AI_INCLUDE_TARGETS=false`, address fields, raw diagnostics and widget text values are withheld. Names you choose can themselves contain personal data; this is not an anonymization guarantee. |

Calendar events, tasks, mail summaries and media content are not automatically included in AI briefing
evidence. The ChatGPT homepage shortcut does not enable the separate AI operations integration.

## Operator responsibilities

Protect the host, environment files, SQLite volume and backups. Keep access private over LAN/VPN and
trusted HTTPS. Server/proxy logs and provider responses can contain operational details; review and
redact them before sharing. Use provider-specific retention and privacy settings where appropriate.
For deletion, use the app's controls and separately manage retained backups, browser storage and any
provider-side data. See [backup and restore](docs/BACKUP_AND_RESTORE.md).

GitHub issues, commits, Actions logs and published artifacts have their own visibility rules. Never
upload real configuration or personal content as a bug reproduction. Use synthetic data.
