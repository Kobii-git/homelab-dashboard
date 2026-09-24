import { useState } from "react";
import { Folder, Globe } from "lucide-react";
import { collectionLabel, type HomeLayout, type HomepageSnapshot, type WorkspaceId } from "../../../shared/homepage";
import { workspaceShortcuts } from "./shortcuts";

export function ShortcutPicker({ snapshot, workspace, layout, onChange }: {
  snapshot: HomepageSnapshot;
  workspace: WorkspaceId;
  layout: HomeLayout;
  onChange: (layout: HomeLayout) => void;
}) {
  const [query, setQuery] = useState("");
  const options = [
    ...snapshot.data.collections.filter(c => c.workspaceId === workspace).sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => ({ id: c.id, kind: "collectionIds" as const, name: c.name, detail: collectionLabel(snapshot.data, c.id) })),
    ...snapshot.bookmarks.filter(b => b.workspaceId === workspace && !b.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder)
      .map(b => ({ id: b.id, kind: "bookmarkIds" as const, name: b.name, detail: collectionLabel(snapshot.data, b.collectionId) })),
  ];
  const matches = options.filter(o => `${o.name} ${o.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="hp-shortcut-picker" aria-label="Choose bookmark placement">
    <h3>A place for every bookmark</h3>
    <p className="muted-copy">Choose each area's links and folders independently. Folders open as dropdowns. A bookmark can live in either area, both, or just your library.</p>
    <label>Find a bookmark or folder<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter your saved places…" /></label>
    <div className="hp-placement-columns">
      {(["center", "sidebar"] as const).map(surface => {
        const key = surface === "center" ? "centerShortcuts" : "sidebarShortcuts";
        const selection = layout[key];
        const { links, folders } = workspaceShortcuts(snapshot, workspace, selection, surface);
        const effective = { bookmarkIds: links.map(b => b.id), collectionIds: folders.map(c => c.id) };
        return <fieldset key={surface}>
          <legend>{surface === "center" ? "Homepage shortcuts" : "Sidebar shortcuts"}</legend>
          <p className="muted-copy">{links.length + folders.length} selected · {selection === null ? (surface === "center" ? "Following favorites" : "Following top-level items") : "Your selection"}</p>
          <div className="hp-actions">
            <button type="button" disabled={selection === null} onClick={() => onChange({ ...layout, [key]: null })}>{surface === "center" ? "Use favorites" : "Use top-level items"}</button>
            <button type="button" onClick={() => onChange({ ...layout, [key]: { bookmarkIds: [], collectionIds: [] } })}>Clear selection</button>
          </div>
          <div className="hp-placement-list" tabIndex={0} role="group" aria-label={`${surface === "center" ? "Homepage" : "Sidebar"} bookmark choices`}>
            {matches.map(option => <label className="hp-placement-option" key={`${option.kind}-${option.id}`}>
              <input type="checkbox" checked={effective[option.kind].includes(option.id)} onChange={event => {
                const ids = effective[option.kind];
                onChange({ ...layout, [key]: { ...effective, [option.kind]: event.target.checked ? [...ids, option.id] : ids.filter(id => id !== option.id) } });
              }} />
              {option.kind === "collectionIds" ? <Folder size={17} aria-hidden="true" /> : <Globe size={17} aria-hidden="true" />}
              <span>{option.name}<small>{option.detail}</small></span>
            </label>)}
            {!matches.length && <p className="muted-copy">{options.length ? "No matching bookmarks or folders." : "Add links or folders in Manage bookmarks to choose them here."}</p>}
          </div>
        </fieldset>;
      })}
    </div>
  </section>;
}
