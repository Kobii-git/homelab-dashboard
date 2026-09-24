# Your browser homepage

Home and Work share saved content through the private dashboard server. Operations retains the
monitoring view. The selected workspace is remembered separately in each browser.

## Search and ChatGPT

The central box defaults to Google. Enter opens current Google results in a new tab, even when a
bookmark suggestion matches. Choose **My bookmarks** to search locally; switch between the current
workspace and all workspaces. Arrow keys select local results, Enter opens them in bookmark mode,
and Escape dismisses suggestions. Typing does not send partial queries to a search provider.

The **ChatGPT** shortcut in Favorites opens your normal ChatGPT account in another tab. Pin conversation URLs as bookmarks.
Work's prompt library stores reusable text with edit, delete, and copy controls. **Copy selected items**
previews selected bookmark titles, URLs, and notes before copying; paste them yourself in ChatGPT.
There is no subscription embedding, ChatGPT history sync, or AI API usage in these homepage features.
The separately configured legacy AI operations briefing is not enabled by homepage setup.

## Bookmarks

Open **Bookmarks → Manage bookmarks → Add bookmark** for an HTTP/HTTPS link without embedded credentials. Choose Home or Work, a
collection, favorite status, notes, and a reading state. The pencil opens a dedicated bookmark editor.
Bookmarks have explicit classification and cannot be monitored. Existing disabled websites are
classified once during upgrade; existing service IDs, groups, and monitoring history are retained.

The slim vertical bookmarks bar shows top-level folders and unfiled links for the selected workspace.
Click a folder to open its small side menu, or click a link to open it in a new tab. It shows the first
24 shortcuts; **Bookmarks** (and **More bookmarks** for larger libraries) opens the complete library.
Dashboard, Services, and Notes sit above the shortcuts, with Settings below. Collapse the bar to icons or hide it;
the reveal button brings it back. On phones, it becomes a compact top strip with a Bookmarks button.

The bar opens a compact bookmark menu without a backdrop. Hover or click a folder inside a menu to open its
submenu to the side. Use Up/Down to move, Right or Enter to open a folder, and Left or Escape to go
back. Escape at the root closes the menu and returns focus to its button; clicking elsewhere dismisses
it and lets you use that control immediately. On narrow screens, folders replace the menu's contents
and a **Back** row returns to the parent folder. Search saved links using **My bookmarks** on the homepage.
The menu is available from every signed-in page. **Switch to Home/Work bookmarks** follows
the same selected workspace as the homepage and Settings. Adding and editing stay in the manager.

Open **Settings → Bookmarks & folders → Manage collections** to create, rename, or reparent folders. Move links and child
collections out before deleting a folder. Select links for bulk workspace/folder moves, trash, or copy.
Trash supports restore; permanent deletion requires confirmation and recent password verification.
Arrow controls provide keyboard ordering; dragging a bookmark onto another also changes its order.
The Settings manager shows 60 links per page. Everyday folders initially show 60 links, with
**Show more bookmarks** for the rest. The library supports up to 10,000 bookmarks.

In **Settings → Bookmarks & folders → Import & export**, import a browser's bookmark **HTML export**, up to 5 MiB / 10,000 links. Review additions, folder paths,
and duplicate counts before applying. Exact normalized URL duplicates in the destination workspace
are skipped, including links already in trash. Query strings and fragments remain significant.
HTML is parsed on the server without executing scripts or loading addresses. Unsafe URLs invalidate
the preview. Preview tokens expire after ten minutes. Undo is available for ten minutes and only if
no configuration changes happened after import; it removes imported links and leaves empty folders.
Export one workspace as browser-compatible HTML or a JSON inventory. JSON inventory import is not
supported; use HTML for browser migration or the configuration archive for a complete restore.

## Customize and plan

**Settings → Appearance & widgets → Customize home/work** controls widget visibility, order, width,
accent, clock, and backgrounds.
Homepage sections have no enclosing panels. Choose **Always open** or **Dropdown** for each section:
dedicated content stays visible, while a dropdown opens when you click its title (or press Enter/Space).
You can mix both styles. Collapsing a section preserves its unsaved draft while you stay in that workspace.
Display choices sync with the saved layout; dropdowns start closed when the workspace opens.
**Bookmarks in sidebar** controls the shortcut's visibility;
its old saved width and position are retained for compatibility but do not affect the page layout.
Save applies the layout to your other devices; Cancel restores the saved layout; Reset changes only
the preview until saved. PNG uploads support non-interlaced RGB/RGBA images under 4 MiB and four
megapixels. Uploaded images live in SQLite and are included in configuration archives. Delete unused
images in customization. Background storage is limited to 24 MiB / 32 images.

Enable Weather in customization, then choose its location and units in **Settings → Integrations & system → Daily tools**. It shows current
conditions and a three-day forecast. Other optional calendar/task/mail/media/storage widgets still
require their existing read-only connector settings. Provider failures do not block saved links.

Open **Notes** in the rail from any page for quick capture and a scrolling saved-note list. Choose Home
or Work to switch note libraries. Search matches titles and full note text. **Save notes** (or
⌘/Ctrl + Enter in the scratchpad) adds a note to the top of the list and clears the scratchpad.
Click a note to read or edit its full text, or use **New note** to give it a title. Deleting a note requires confirmation.
The same notes can appear as a homepage widget; Work also includes a reading list, prompt templates,
and a 25-minute timer.
Original scratchpad text remains available as a note called **Scratchpad**. Saving that original note
moves it into the saved list. Saved notes sync; unsaved drafts stay in the open editor. The timestamp-based timer survives reload in
that browser but is not shared. Leaving a workspace closes its editor, so save drafts before switching.

The **Services** sidebar item opens a service launcher with search by name or description. Click a
service's icon, name, or description to open it. **Manage services** opens configuration
under Settings; homepage service filters and layout controls are collapsed under **Service options**.

Integration settings are grouped into **Daily tools**, **Connections**, and **Account & runtime**.
Changing groups preserves unsaved form edits while the Settings page stays open.

For Todoist, enable its read-only source in **Settings → Integrations & system → Daily tools → Personal context**,
then enable the **Todoist** widget for Home or Work under Appearance & widgets. The source requires
the existing server environment token; credentials are never stored in notes or browser settings.

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
