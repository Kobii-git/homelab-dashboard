import { Bookmark } from "lucide-react";
import { ShortcutMenu } from "./ShortcutMenu";
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
  const { links } = home.snapshot
    ? workspaceShortcuts(home.snapshot, workspace, home.snapshot.data.workspaces[workspace].layout.sidebarShortcuts, "sidebar")
    : { links: [] };
  const menuProps = { home, workspace, onWorkspace: setWorkspace, onManage };
  return <div className="bookmark-rail" role="group" aria-label="Bookmark shortcuts">
    <BookmarkMenu {...menuProps} />
    <div className="bookmark-rail-items">
      {links.slice(0, 24).map(link => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" title={link.name}>
        <SiteIcon name={link.name} url={link.url} size={28} /><span className="nav-label">{link.name}</span>
      </a>)}
      {links.length > 24 && <ShortcutMenu key={workspace} label="More sidebar links" icon={<Bookmark size={19} />} side
        items={links.slice(24).map(link => ({ id: link.id, label: link.name, href: link.url, icon: <SiteIcon name={link.name} url={link.url} size={28} /> }))} />}
    </div>
  </div>;
}
