import { BookmarkMenu } from "./BookmarkMenu";
import { useHomepage } from "./useHomepage";
import { useHomepageWorkspace } from "./useHomepageWorkspace";
import { Globe } from "lucide-react";

export function SidebarBookmarks({ onManage }: { onManage: () => void }) {
  const home = useHomepage();
  const [workspace, setWorkspace] = useHomepageWorkspace();
  const enabled = home.snapshot?.data.workspaces[workspace].layout.widgets.some(w => w.id === "bookmarks" && w.enabled) ?? true;
  if (!enabled) return null;
  const folders = home.snapshot?.data.collections.filter(c => c.workspaceId === workspace && c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder) ?? [];
  const links = home.snapshot?.bookmarks.filter(b => b.workspaceId === workspace && !b.deletedAt && b.collectionId === null) ?? [];
  const shortcuts = [
    ...folders.map(folder => ({ kind: "folder" as const, value: folder })),
    ...links.map(link => ({ kind: "link" as const, value: link })),
  ];
  const menuProps = { home, workspace, onWorkspace: setWorkspace, onManage };
  return <div className="bookmark-rail" role="group" aria-label="Bookmark shortcuts">
    <BookmarkMenu {...menuProps} />
    <div className="bookmark-rail-items">
      {shortcuts.slice(0, 24).map(shortcut => shortcut.kind === "folder"
        ? <BookmarkMenu key={shortcut.value.id} {...menuProps} folder={shortcut.value} />
        : <a key={shortcut.value.id} href={shortcut.value.url} target="_blank" rel="noopener noreferrer" title={shortcut.value.name}>
          <Globe size={19} /><span className="nav-label">{shortcut.value.name}</span>
        </a>)}
      {shortcuts.length > 24 && <BookmarkMenu {...menuProps} label="More bookmarks" />}
    </div>
  </div>;
}
