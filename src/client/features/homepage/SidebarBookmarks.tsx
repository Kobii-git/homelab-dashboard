import { BookmarkMenu } from "./BookmarkMenu";
import { useHomepage } from "./useHomepage";
import { useHomepageWorkspace } from "./useHomepageWorkspace";
import { SiteIcon } from "../../components/SiteIcon";
import { workspaceShortcuts } from "./shortcuts";

export function SidebarBookmarks({ onManage }: { onManage: () => void }) {
  const home = useHomepage();
  const [workspace, setWorkspace] = useHomepageWorkspace();
  const enabled = home.snapshot?.data.workspaces[workspace].layout.widgets.some(w => w.id === "bookmarks" && w.enabled) ?? true;
  if (!enabled) return null;
  const { folders, links } = home.snapshot
    ? workspaceShortcuts(home.snapshot, workspace, home.snapshot.data.workspaces[workspace].layout.sidebarShortcuts, "sidebar")
    : { folders: [], links: [] };
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
          <SiteIcon name={shortcut.value.name} url={shortcut.value.url} size={28} /><span className="nav-label">{shortcut.value.name}</span>
        </a>)}
      {shortcuts.length > 24 && <BookmarkMenu {...menuProps} label="More bookmarks" />}
    </div>
  </div>;
}
