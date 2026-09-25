import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { BookmarkPopup } from "./BookmarkMenu";

export type ShortcutItem = { id: string; label: string; icon: ReactNode; href?: string; onSelect?: () => void };

export function ShortcutMenu({ label, icon, items, side = false }: { label: string; icon: ReactNode; items: ShortcutItem[]; side?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Element && !trigger.current?.contains(event.target) && !event.target.closest(`[data-bookmark-popup="${id}"]`)) close(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", key); };
  }, [open, id]);
  return <>
    <button ref={trigger} type="button" className="hp-bookmark-trigger" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { trigger.current?.focus(); setOpen(!open); }}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); setOpen(true); } }}>
      {icon}<span className="nav-label">{label}</span><ChevronDown className="bookmark-nav-chevron" size={14} />
    </button>
    {open && trigger.current && createPortal(<BookmarkPopup id={id} owner={id} label={label} anchor={trigger.current} nested={side && window.innerWidth >= 600} focus
      before={null} after={null} count={items.length} moreLabel={side ? "Show more links" : "Show more favorites"} onBack={() => close()} onTab={() => close()} onPointerEnter={() => {}} onScroll={() => {}}
      renderRows={limit => items.slice(0, limit).map(item => item.href ? <a key={item.id} role="menuitem" tabIndex={-1} href={item.href} target="_blank" rel="noopener noreferrer" title={item.label} onClick={() => close()}>{item.icon}<span>{item.label}</span></a>
        : <button key={item.id} type="button" role="menuitem" tabIndex={-1} title={item.label} onClick={() => { close(); item.onSelect?.(); }}>{item.icon}<span>{item.label}</span></button>)} />, document.body)}
  </>;
}
