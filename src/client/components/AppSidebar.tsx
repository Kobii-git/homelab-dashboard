import { LogOut, Moon, PanelLeft, PanelLeftClose, Search, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarBookmarks } from "../features/homepage/SidebarBookmarks";
import type { AppView } from "../features/types";
import type { SidebarMode, ThemeMode } from "../lib/appChrome";

type NavItem = { id: AppView; label: string; icon: ReactNode };

export function AppSidebar({
  navItems, view, onNavigate, sidebarMode, onCycleSidebar, theme,
  onToggleTheme, onOpenPalette, onManageBookmarks, onLogout
}: {
  navItems: NavItem[];
  view: AppView;
  onNavigate: (view: AppView) => void;
  sidebarMode: SidebarMode;
  onCycleSidebar: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onManageBookmarks: () => void;
  onLogout: () => void;
}) {
  const compact = sidebarMode === "compact";
  const hidden = sidebarMode === "hidden";
  function navigationButton(item: NavItem) {
    return <button
      key={item.id}
      className={view === item.id ? "active" : ""}
      type="button"
      title={item.label}
      aria-label={item.label}
      aria-current={view === item.id ? "page" : undefined}
      onClick={() => onNavigate(item.id)}
    >{item.icon}<span className="nav-label">{item.label}</span></button>;
  }
  return <>
    {hidden && <button className="sidebar-reveal" type="button" title="Show bookmarks bar" onClick={onCycleSidebar}><PanelLeft size={18} /></button>}
    <aside className={`sidebar bookmark-sidebar ${compact ? "is-compact" : ""} ${hidden ? "is-hidden" : ""}`} aria-label="Bookmarks bar">
      <button className="sidebar-search" type="button" title="Search (⌘K)" aria-label="Search (⌘K)" onClick={event => { event.currentTarget.focus(); onOpenPalette(); }}><Search size={18} /></button>
      <nav className="nav-list" aria-label="Primary">
        <div className="rail-navigation">{navItems.filter(item => item.id !== "settings").map(navigationButton)}</div>
        <SidebarBookmarks onManage={onManageBookmarks} />
        <div className="rail-settings">{navItems.filter(item => item.id === "settings").map(navigationButton)}</div>
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-tool" type="button" title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={onToggleTheme}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
        <button className="sidebar-tool sidebar-logout" type="button" title="Log out" onClick={onLogout}><LogOut size={16} /></button>
        <button className="sidebar-tool sidebar-toggle" type="button" title={compact ? "Hide bookmarks bar" : "Collapse bookmarks bar"} onClick={onCycleSidebar}>{compact ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}</button>
      </div>
    </aside>
  </>;
}
