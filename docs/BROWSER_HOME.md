# Your browser homepage

Home and Work share saved content through the private dashboard server. Operations retains the
monitoring view. The selected workspace is remembered separately in each browser.

## Search and ChatGPT

The central box defaults to Google. Enter opens current Google results in a new tab, even when a
bookmark suggestion matches. Choose **My bookmarks** to search locally; switch between the current
workspace and all workspaces. Arrow keys select local results, Enter opens them in bookmark mode,
and Escape dismisses suggestions. Typing does not send partial queries to a search provider.

**Open ChatGPT** opens your normal ChatGPT account in another tab. Pin conversation URLs as bookmarks.
Work's prompt library stores reusable text with edit, delete, and copy controls. **Copy selected items**
previews selected bookmark titles, URLs, and notes before copying; paste them yourself in ChatGPT.
There is no subscription embedding, ChatGPT history sync, or AI API usage in these homepage features.
The separately configured legacy AI operations briefing is not enabled by homepage setup.

## Bookmarks

Use **Add bookmark** for an HTTP/HTTPS link without embedded credentials. Choose Home or Work, a
collection, favorite status, notes, and a reading state. The pencil opens a dedicated bookmark editor.
Bookmarks have explicit classification and cannot be monitored. Existing disabled websites are
classified once during upgrade; existing service IDs, groups, and monitoring history are retained.

**Manage collections** creates nested folders and renames or reparents them. Move links and child
collections out before deleting a folder. Select links for bulk workspace/folder moves, trash, or copy.
Trash supports restore; permanent deletion requires confirmation and recent password verification.
Arrow controls provide keyboard ordering; dragging a bookmark onto another also changes its order.
Lists show 60 links per page and support up to 10,000 bookmarks.

Import a browser's bookmark **HTML export**, up to 5 MiB / 10,000 links. Review additions, folder paths,
and duplicate counts before applying. Exact normalized URL duplicates in the destination workspace
are skipped, including links already in trash. Query strings and fragments remain significant.
HTML is parsed on the server without executing scripts or loading addresses. Unsafe URLs invalidate
the preview. Preview tokens expire after ten minutes. Undo is available for ten minutes and only if
no configuration changes happened after import; it removes imported links and leaves empty folders.
Export one workspace as browser-compatible HTML or a JSON inventory. JSON inventory import is not
supported; use HTML for browser migration or the configuration archive for a complete restore.

## Customize and plan

**Customize home/work** previews widget visibility, order, width, accent, clock, and backgrounds.
Save applies the layout to your other devices; Cancel restores the saved layout; Reset changes only
the preview until saved. PNG uploads support non-interlaced RGB/RGBA images under 4 MiB and four
megapixels. Uploaded images live in SQLite and are included in configuration archives. Delete unused
images in customization. Background storage is limited to 24 MiB / 32 images.

Enable Weather in customization, then choose its location and units in Admin. It shows current
conditions and a three-day forecast. Other optional calendar/task/mail/media/storage widgets still
require their existing read-only connector settings. Provider failures do not block saved links.

Work includes a scratchpad with explicit Save, a reading list, prompt templates, and a 25-minute timer.
Saved notes sync; unsaved drafts stay in the open editor. The timestamp-based timer survives reload in
that browser but is not shared. Leaving a workspace closes its editor, so save drafts before switching.

Visible pages refresh saved state every 30 seconds and on focus or reconnection. Hidden pages pause
polling. Concurrent edits produce a conflict, preserve the draft, and offer reload plus deliberate
resubmission against the latest version. The app is not an offline editor or native browser sync tool.

## Browser setup

Use the deployed `https://home.example.com` address after completing [private HTTPS](PRIVATE_HTTPS.md).
A **homepage** controls the Home button, **startup** controls new browser launches, and **new tab** is a
separate browser feature. Configure each one you want. Session expiry still requires sign-in.

| Browser | Homepage / startup | New tabs |
|---|---|---|
| Chrome | Settings → Appearance → Home button; On startup → Open specific pages | An approved existing redirect extension is needed for a custom URL. |
| Edge | Settings → Start, home, and new tabs; set startup and Home-button URL | Use an approved compatible redirect extension; browser policy can override it. |
| Brave | Settings → Appearance and On startup | Use an approved Chromium-compatible redirect extension. |
| Firefox | Settings → Home → Homepage and new windows → Custom URLs | New Tab Override is an existing option; inspect its permissions before installing. |
| Safari on macOS | Settings → General → Homepage; set new windows to Homepage | Set “New tabs open with” to Homepage; no redirect extension is required. |

Extension review (2026-09-24): [Firefox New Tab Override](https://addons.mozilla.org/en-US/firefox/addon/new-tab-override/)
listed version 19.0.0, updated July 19, 2026. Its declared permissions include settings, history,
recently closed tabs, tabs, cookie/container handling, and storage. These permissions are broader than
a simple link, so review them before choosing it. The Chromium [New Tab Redirect listing](https://chromewebstore.google.com/detail/new-tab-redirect/icpgjfneehieebagbmdbhnlpiopdcmna)
listed version 3.1.6, last updated October 24, 2023; its age means it is a candidate requiring fresh
compatibility/permission review, not a blanket recommendation. No extension is installed by this app.

Mobile browsers have different startup/new-tab restrictions and may not support these extensions.
Use a bookmark or Add to Home Screen shortcut where available. This app does not override the address
bar, manage native browser tabs, or copy browser passwords/history. When away from home, connect your
VPN first; if DNS or routing fails, the browser itself may show an unreachable-page error.

See [configuration backups](BACKUP_AND_RESTORE.md) and the [optional feature backlog](HOMEPAGE_BACKLOG.md).
