import {
  Gauge,
  PanelLeft,
  PanelLeftClose
} from "lucide-react";
import type { ReactNode } from "react";
import type { AppView } from "../features/types";
import type { SidebarMode } from "../lib/appChrome";
import { BuildBadge } from "./BuildBadge";

type NavItem = { id: AppView; label: string; icon: ReactNode };

export function AppSidebar({
  navItems,
  view,
  onNavigate,
  sidebarMode,
  onCycleSidebar
}: {
  navItems: NavItem[];
  view: AppView;
  onNavigate: (view: AppView) => void;
  sidebarMode: SidebarMode;
  onCycleSidebar: () => void;
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
          {!compact ? <BuildBadge className="sidebar-build-badge" /> : null}
        </div>
      </aside>
    </>
  );
}

export function adminNavItem(): NavItem {
  return { id: "settings", label: "Admin", icon: <span /> };
}
