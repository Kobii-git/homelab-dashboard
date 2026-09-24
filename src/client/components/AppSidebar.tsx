import {
  Gauge,
  LogOut,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Sun
} from "lucide-react";
import type { ReactNode } from "react";
import type { AppView } from "../features/types";
import type { SidebarMode, ThemeMode } from "../lib/appChrome";
import { BuildBadge } from "./BuildBadge";

type NavItem = { id: AppView; label: string; icon: ReactNode };

export function AppSidebar({
  navItems,
  view,
  onNavigate,
  sidebarMode,
  onCycleSidebar,
  theme,
  onToggleTheme,
  onOpenPalette,
  onLogout
}: {
  navItems: NavItem[];
  view: AppView;
  onNavigate: (view: AppView) => void;
  sidebarMode: SidebarMode;
  onCycleSidebar: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onLogout: () => void;
}) {
  const compact = sidebarMode === "compact";
  const hidden = sidebarMode === "hidden";

  return (
    <>
      {hidden ? (
        <button className="sidebar-reveal" type="button" title="Show navigation" onClick={onCycleSidebar}>
          <PanelLeft size={18} />
        </button>
      ) : null}

      <aside className={`sidebar ${compact ? "is-compact" : ""} ${hidden ? "is-hidden" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark brand-mark-sm"><Gauge size={compact ? 16 : 18} /></span>
          {!compact ? <span>Homelab</span> : null}
          <button
            className="icon-button sidebar-toggle"
            type="button"
            title={compact ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onCycleSidebar}
          >
            {compact ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <button className="sidebar-search" type="button" title="Search (⌘K)" onClick={(event) => { event.currentTarget.focus(); onOpenPalette(); }}>
          <Search size={15} />
          {!compact ? (
            <>
              <span>Search</span>
              <kbd>⌘K</kbd>
            </>
          ) : null}
        </button>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              type="button"
              key={item.id}
              title={item.label}
              onClick={() => onNavigate(item.id)}
            >
              {item.icon}
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="sidebar-tool"
            type="button"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {!compact ? <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span> : null}
          </button>
          <button className="sidebar-tool sidebar-logout" type="button" title="Log out" onClick={onLogout}>
            <LogOut size={16} />
            {!compact ? <span>Log out</span> : null}
          </button>
          {!compact ? <BuildBadge className="sidebar-build-badge" /> : null}
        </div>
      </aside>
    </>
  );
}
