import { SiteIcon } from "../../components/SiteIcon";
import { useState } from "react";
import { ChevronRight, Folder, Pencil } from "lucide-react";
import type { HomepageBookmark, HomepageSnapshot, WorkspaceId } from "../../../shared/homepage";
import { bookmarkHostname } from "../../lib/bookmarks";

type Props = { snapshot: HomepageSnapshot; workspace: WorkspaceId; onEdit: (bookmark: HomepageBookmark) => void };

export function BookmarkTree({ snapshot, workspace, onEdit }: Props) {
  const bookmarks = snapshot.bookmarks.filter(b => b.workspaceId === workspace && !b.deletedAt);
  const folders = snapshot.data.collections.filter(c => c.workspaceId === workspace).sort((a, b) => a.sortOrder - b.sortOrder);
  function branch(parentId: string | null) {
    return <>
      {folders.filter(c => c.parentId === parentId).map(c => <BookmarkFolder key={c.id} name={c.name}>
        {branch(c.id)}
        {!folders.some(child => child.parentId === c.id) && !bookmarks.some(b => b.collectionId === c.id) && <p className="muted-copy hp-folder-empty">This folder is empty.</p>}
      </BookmarkFolder>)}
      <BookmarkLinks bookmarks={bookmarks.filter(b => b.collectionId === parentId)} onEdit={onEdit} />
    </>;
  }
  return <div className="hp-bookmark-tree">{branch(null)}{!bookmarks.length && !folders.length && <p className="muted-copy">Your favorite corners of the web. Add a bookmark to get started.</p>}</div>;
}
function BookmarkFolder({ name, children }: { name: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="hp-folder" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><ChevronRight size={15} className="hp-folder-chevron" /><Folder size={18} /><strong>{name}</strong></summary>
    {open && <div className="hp-folder-content">{children}</div>}
  </details>;
}
function BookmarkLinks({ bookmarks, onEdit }: { bookmarks: HomepageBookmark[]; onEdit: Props["onEdit"] }) {
  const [limit, setLimit] = useState(60);
  return <>
    {bookmarks.slice(0, limit).map(b => <div className="hp-bookmark-link" key={b.id}>
      <a href={b.url} target="_blank" rel="noopener noreferrer"><SiteIcon name={b.name} url={b.url} size={28} /><span><strong>{b.name}</strong><small>{bookmarkHostname(b.url)}</small></span></a>
      <button className="icon-button" aria-label={`Edit bookmark ${b.name}`} onClick={() => onEdit(b)}><Pencil size={14} /></button>
    </div>)}
    {bookmarks.length > limit && <button onClick={() => setLimit(limit + 60)}>Show more bookmarks</button>}
  </>;
}
