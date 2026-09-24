import { useState } from "react";
import { ArrowUpRight, Plus, Search, Settings2 } from "lucide-react";
import type { WorkspaceId } from "../../../shared/homepage";
import { BookmarkMenu } from "./BookmarkMenu";
import type { HomepageController } from "./useHomepage";
import { workspaceShortcuts } from "./shortcuts";

export function HomepageStart({ home, workspace, onWorkspace, onCustomize, onManage }: {
  home: HomepageController;
  workspace: WorkspaceId;
  onWorkspace: (workspace: WorkspaceId) => void;
  onCustomize: () => void;
  onManage: () => void;
}) {
  const [query, setQuery] = useState("");
  const snapshot = home.snapshot!;
  const layout = snapshot.data.workspaces[workspace].layout;
  const { folders, links } = workspaceShortcuts(snapshot, workspace, layout.centerShortcuts, "center");
  return <section className={`hp-start hp-shortcuts-${layout.shortcutStyle}`} aria-label="Search and shortcuts">
    <form className="hp-google-search" role="search" aria-label="Google" onSubmit={event => {
      event.preventDefault();
      if (query.trim()) window.open(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`, "_blank", "noopener,noreferrer");
    }}>
      <span className="hp-google-mark" aria-hidden="true">G</span>
      <input type="search" aria-label="Search Google" placeholder="Search anything with Google…" value={query} onChange={event => setQuery(event.target.value)} />
      <button className="primary-button" type="submit" aria-label="Search Google"><Search size={18} /><span>Search</span></button>
    </form>
    <div className="hp-shortcut-heading"><div><span className="hp-eyebrow">Your everyday places</span><h3>Your shortcuts</h3></div>
      <div className="hp-actions"><button type="button" onClick={onManage}><Plus size={15} /> Add bookmark</button><button type="button" onClick={onCustomize}><Settings2 size={15} /> Choose shortcuts</button></div>
    </div>
    <nav className="hp-center-shortcuts" aria-label="Homepage shortcuts">
      {links.map(link => <a key={link.id} className="hp-center-link" href={link.url} target="_blank" rel="noopener noreferrer">
        <span className="hp-shortcut-icon" aria-hidden="true">{link.name.charAt(0).toUpperCase()}</span><span>{link.name}</span><ArrowUpRight size={14} aria-hidden="true" />
      </a>)}
      {folders.map(folder => <BookmarkMenu key={folder.id} home={home} workspace={workspace} onWorkspace={onWorkspace} onManage={onManage} folder={folder} placement="below" />)}
      {!links.length && !folders.length && <button type="button" className="hp-shortcut-empty" onClick={onCustomize}><Plus size={22} /><span><strong>Keep your go-to places here</strong><small>Choose links or folders, separately from your sidebar.</small></span></button>}
    </nav>
  </section>;
}
