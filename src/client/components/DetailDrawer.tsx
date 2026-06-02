import { X } from "lucide-react";
import type { ReactNode } from "react";

export type DrawerState =
  | { type: "resource"; title: string; body: ReactNode }
  | { type: "connection"; title: string; body: ReactNode }
  | { type: "credential"; title: string; body: ReactNode }
  | { type: "incident"; title: string; body: ReactNode }
  | { type: "check"; title: string; body: ReactNode }
  | null;

export function DetailDrawer({
  drawer,
  onClose
}: {
  drawer: DrawerState;
  onClose: () => void;
}) {
  if (!drawer) {
    return null;
  }

  return (
    <aside className="detail-drawer" aria-label={drawer.title}>
      <div className="drawer-header">
        <div>
          <small>{drawer.type}</small>
          <h2>{drawer.title}</h2>
        </div>
        <button className="icon-button" type="button" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="drawer-body">{drawer.body}</div>
    </aside>
  );
}
