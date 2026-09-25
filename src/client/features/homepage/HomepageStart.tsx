import { useState, type ReactNode } from "react";
import { FolderPlus, Search, Settings2 } from "lucide-react";
import type { WorkspaceId } from "../../../shared/homepage";
import { BookmarkMenu } from "./BookmarkMenu";
import type { HomepageController } from "./useHomepage";
import { workspaceShortcuts } from "./shortcuts";

export function HomepageStart({ home, workspace, onWorkspace, onCustomize, onManage, favorites }: {
  home: HomepageController;
  workspace: WorkspaceId;
  onWorkspace: (workspace: WorkspaceId) => void;
  onCustomize: () => void;
  onManage: () => void;
  favorites: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const snapshot = home.snapshot!;
  const layout = snapshot.data.workspaces[workspace].layout;
  const { folders } = workspaceShortcuts(snapshot, workspace, layout.centerShortcuts, "center");
  return <section className="hp-start" aria-label="Bookmarks and search">
    <div className="hp-bookmark-bar">
      <nav className="hp-folder-bar" aria-label="Bookmark folders">
        {folders.map(folder => <BookmarkMenu key={`${workspace}-${folder.id}`} home={home} workspace={workspace} onWorkspace={onWorkspace} onManage={onManage} folder={folder} placement="below" />)}
        {!folders.length && <button type="button" className="hp-folder-empty" onClick={onManage}><FolderPlus size={16} /><span>Add bookmark folders</span></button>}
      </nav>
      {favorites}
      <button type="button" className="hp-folder-settings" onClick={onCustomize} aria-label="Choose bookmark folders" title="Choose bookmark folders"><Settings2 size={16} /></button>
    </div>
    <form className="hp-google-search" role="search" aria-label="Google" onSubmit={event => {
      event.preventDefault();
      if (query.trim()) window.open(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`, "_blank", "noopener,noreferrer");
    }}>
      <span className="hp-google-mark" aria-hidden="true">G</span>
      <input type="search" aria-label="Search Google" placeholder="Search anything with Google…" value={query} onChange={event => setQuery(event.target.value)} />
      <button className="primary-button" type="submit" aria-label="Search Google"><Search size={18} /><span>Search</span></button>
    </form>
  </section>;
}
