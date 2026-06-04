import {
  Gauge,
  LogOut,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Shield,
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
  onOpenKeyboardHelp,
  onLogout,
  liveSessionCount,
  openIncidents,
  failingChecks,
  vaultCount
}: {
  navItems: NavItem[];
  view: AppView;
  onNavigate: (view: AppView) => void;
  sidebarMode: SidebarMode;
  onCycleSidebar: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onOpenKeyboardHelp: () => void;
  onLogout: () => void;
  liveSessionCount: number;
  openIncidents: number;
  failingChecks: number;
  vaultCount: number;
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
          <Gauge size={compact ? 20 : 24} />
          {!compact ? <span>Homelab</span> : null}
          <button className="icon-button sidebar-toggle" type="button" title={compact ? "Expand sidebar" : "Collapse sidebar"} onClick={onCycleSidebar}>
            {compact ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <button className="sidebar-search" type="button" title="Command palette (Ctrl K)" onClick={onOpenPalette}>
          <Search size={16} />
          {!compact ? (
            <>
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </>
          ) : null}
        </button>

        {!compact ? (
          <div className="sidebar-stats" aria-label="Summary">
            <span className="sidebar-stat">{openIncidents} incidents</span>
            <span className="sidebar-stat">{failingChecks} failing</span>
            <span className="sidebar-stat">{liveSessionCount} live</span>
            <span className="sidebar-stat">{vaultCount} vault</span>
          </div>
        ) : null}

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
              {!compact ? item.label : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-tool" type="button" title="Keyboard shortcuts" onClick={onOpenKeyboardHelp}>
            <Shield size={16} />
            {!compact ? <span>Shortcuts</span> : null}
          </button>
          <button className="sidebar-tool" type="button" title="Toggle theme" onClick={onToggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {!compact ? <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span> : null}
          </button>
          {!compact ? <BuildBadge className="sidebar-build-badge" /> : null}
          <button className="nav-utility" type="button" title="Logout" onClick={onLogout}>
            <LogOut size={18} />
            {!compact ? "Logout" : null}
          </button>
        </div>
      </aside>
    </>
  );
}

export function settingsNavItem(): NavItem {
  return { id: "settings", label: "Settings", icon: <Settings size={18} /> };
}
