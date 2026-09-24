import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Bookmark, ChevronDown, ChevronRight, Folder, Globe, Settings2, Repeat2 } from "lucide-react";
import type { WorkspaceId } from "../../../shared/homepage";
import type { HomepageController } from "./useHomepage";

type OpenFolder = { id: string; name: string; anchor: HTMLElement; focus: boolean };
const menuItems = '[role="menuitem"]:not([disabled])';

export function BookmarkMenu({ home, workspace, onWorkspace, onManage, folder, label = "Bookmarks", placement = "side" }: {
  home: HomepageController;
  workspace: WorkspaceId;
  onWorkspace: (workspace: WorkspaceId) => void;
  onManage: () => void;
  folder?: { id: string; name: string };
  label?: string;
  placement?: "side" | "below";
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<OpenFolder[]>([]);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 600);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const id = useId();
  const rootId = `${id}-root`;
  const folders = home.snapshot?.data.collections.filter(c => c.workspaceId === workspace).sort((a, b) => a.sortOrder - b.sortOrder) ?? [];
  const bookmarks = home.snapshot?.bookmarks.filter(b => b.workspaceId === workspace && !b.deletedAt) ?? [];

  function cancelHover() { window.clearTimeout(hoverTimer.current); }
  function close(restoreFocus = true) {
    cancelHover();
    setOpen(false);
    setPath([]);
    if (restoreFocus) trigger.current?.focus();
  }
  function back(level: number) {
    cancelHover();
    const parent = path[level - 1];
    setPath(current => current.slice(0, level - 1));
    if (!narrow) parent?.anchor.focus();
  }
  function openFolder(level: number, folder: OpenFolder) {
    cancelHover();
    setPath(current => [...current.slice(0, level), folder]);
  }
  function hover(action: () => void) {
    cancelHover();
    hoverTimer.current = window.setTimeout(action, 140);
  }
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => target instanceof Element &&
      (trigger.current?.contains(target) || target.closest(`[data-bookmark-popup="${id}"]`));
    function outside(event: Event) { if (!inside(event.target)) close(false); }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (path.length) back(path.length); else close();
      }
    }
    function resize() {
      setNarrow(window.innerWidth < 600);
      setPath([]);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
    };
  }, [open, path, narrow, id]);

  function panel(level: number) {
    const parent = path[level - 1];
    const parentId = parent?.id ?? folder?.id ?? null;
    const rows = [
      ...folders.filter(c => c.parentId === parentId).map(c => ({ kind: "folder" as const, value: c })),
      ...bookmarks.filter(b => b.collectionId === parentId).map(b => ({ kind: "link" as const, value: b })),
    ];
    return <BookmarkPopup
      key={`${workspace}-${parentId ?? "root"}`}
      id={parent ? `${id}-${parent.id}` : rootId}
      owner={id}
      label={parent?.name ?? folder?.name ?? `${workspace === "work" ? "Work" : "Home"} bookmarks`}
      anchor={narrow ? trigger.current! : parent?.anchor ?? trigger.current!}
      nested={!narrow && (level > 0 || placement === "side")}
      focus={narrow || !parent || parent.focus}
      onPointerEnter={cancelHover}
      onBack={level ? () => back(level) : () => close()}
      onTab={() => close()}
      onScroll={() => { cancelHover(); setPath(current => current.length > level ? current.slice(0, level) : current); }}
      count={rows.length}
      renderRows={limit => rows.slice(0, limit).map(row => row.kind === "folder" ? <button
        key={row.value.id}
        type="button"
        role="menuitem"
        tabIndex={-1}
        title={row.value.name}
        aria-haspopup="menu"
        aria-expanded={path[level]?.id === row.value.id}
        aria-controls={path[level]?.id === row.value.id ? `${id}-${row.value.id}` : undefined}
        onPointerEnter={event => {
          if (event.pointerType !== "mouse" || narrow) return;
          const anchor = event.currentTarget;
          hover(() => openFolder(level, { id: row.value.id, name: row.value.name, anchor, focus: false }));
        }}
        onClick={event => openFolder(level, { id: row.value.id, name: row.value.name, anchor: event.currentTarget, focus: true })}
        onKeyDown={event => {
          if (event.key === "ArrowRight" || event.key === " ") {
            event.preventDefault();
            openFolder(level, { id: row.value.id, name: row.value.name, anchor: event.currentTarget, focus: true });
          }
        }}
      ><Folder size={15} /><span>{row.value.name}</span><ChevronRight size={13} /></button> : <a
        key={row.value.id}
        className="hp-menu-link"
        role="menuitem"
        tabIndex={-1}
        title={`${row.value.name} — ${row.value.url}`}
        href={row.value.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => close()}
        onPointerEnter={event => { if (event.pointerType === "mouse") hover(() => setPath(current => current.slice(0, level))); }}
      ><Globe size={15} /><span>{row.value.name}</span></a>)}
      before={narrow && parent ? <button type="button" role="menuitem" tabIndex={-1} onClick={() => back(level)}><ArrowLeft size={15} /><span>Back</span></button> : null}
      after={!parent ? <>
        {home.error && <button type="button" role="menuitem" tabIndex={-1} onClick={() => void home.refresh()}>Couldn’t load bookmarks · Retry</button>}
        {!home.snapshot && !home.error && <button type="button" role="menuitem" disabled>Loading bookmarks…</button>}
        <div role="separator" />
        {!folder && <button type="button" role="menuitem" tabIndex={-1} onClick={() => { cancelHover(); setPath([]); onWorkspace(workspace === "home" ? "work" : "home"); }}><Repeat2 size={15} /><span>Switch to {workspace === "home" ? "Work" : "Home"} bookmarks</span></button>}
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { close(); onManage(); }}><Settings2 size={15} /><span>Manage bookmarks</span></button>
      </> : null}
    />;
  }
  return <>
    <button
      ref={trigger}
      type="button"
      className={`hp-bookmark-trigger ${folder ? "bookmark-rail-folder" : ""}`}
      aria-label={folder?.name ?? label}
      title={folder?.name ?? label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? (narrow && path.length ? `${id}-${path[path.length - 1].id}` : rootId) : undefined}
      onClick={() => { if (open) close(); else { trigger.current?.focus(); setNarrow(window.innerWidth < 600); setOpen(true); } }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          setNarrow(window.innerWidth < 600);
          setOpen(true);
          document.getElementById(rootId)?.querySelector<HTMLElement>(menuItems)?.focus();
        }
      }}
    >{folder ? <Folder size={19} /> : <Bookmark size={19} />}<span className="nav-label">{folder?.name ?? label}</span><ChevronDown className="bookmark-nav-chevron" size={14} /></button>
    {open && trigger.current && createPortal(narrow ? panel(path.length) : <>{panel(0)}{path.map((_, index) => panel(index + 1))}</>, document.body)}
  </>;
}

function BookmarkPopup({ id, owner, label, anchor, nested, focus, before, after, count, renderRows, onBack, onTab, onScroll, onPointerEnter }: {
  id: string; owner: string; label: string; anchor: HTMLElement; nested: boolean; focus: boolean;
  before: ReactNode; after: ReactNode; count: number; renderRows: (limit: number) => ReactNode;
  onBack: () => void; onTab: () => void; onScroll: () => void; onPointerEnter: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(60);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    function place() {
      if (!ref.current) return;
      const rect = anchor.getBoundingClientRect();
      const { width, height } = ref.current.getBoundingClientRect();
      const left = nested ? (rect.right + width + 4 <= window.innerWidth - 8 ? rect.right + 4 : rect.left - width - 4) : rect.left;
      const top = nested ? rect.top - 6 : rect.bottom + 4;
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - height - 8)) });
    }
    place();
    // Parent flyouts finish positioning in the same commit. Measure again once
    // their new screen positions have been applied, before following the pointer.
    const frame = window.requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, nested, limit, count]);
  useEffect(() => {
    if (focus) (ref.current?.querySelector<HTMLElement>(menuItems) ?? ref.current)?.focus();
  }, [focus]);
  return <div
    ref={ref}
    id={id}
    className="hp-bookmark-popup"
    data-bookmark-popup={owner}
    role="menu"
    aria-label={label}
    tabIndex={-1}
    style={position}
    onPointerEnter={onPointerEnter}
    onScroll={onScroll}
    onKeyDown={event => {
      const items = Array.from(ref.current!.querySelectorAll<HTMLElement>(menuItems));
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onBack();
      } else if (event.key === "Tab") onTab();
      else if (event.key === " " && event.target instanceof HTMLAnchorElement) { event.preventDefault(); event.target.click(); }
    }}
  >
    {before}
    {renderRows(limit)}
    {!count && <button type="button" role="menuitem" disabled>No bookmarks here yet</button>}
    {count > limit && <button type="button" role="menuitem" tabIndex={-1} onClick={() => {
      const nextIndex = limit + (before ? 1 : 0);
      setLimit(current => current + 60);
      window.requestAnimationFrame(() => ref.current?.querySelectorAll<HTMLElement>(menuItems)[nextIndex]?.focus());
    }}>Show more bookmarks</button>}
    {after}
  </div>;
}
