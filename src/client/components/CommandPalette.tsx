import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardResource } from "../../shared/types";
import { serviceAddress, statusFor } from "../lib/format";
import { ServiceIcon } from "./ServiceIcon";
import { ModalSurface } from "./ModalSurface";

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

type PaletteItem =
  | { type: "service"; resource: DashboardResource }
  | { type: "command"; command: PaletteCommand };

export function CommandPalette({
  open,
  onClose,
  resources,
  commands,
  onLaunch
}: {
  open: boolean;
  onClose: () => void;
  resources: DashboardResource[];
  commands: PaletteCommand[];
  onLaunch: (resource: DashboardResource) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const needle = query.trim().toLowerCase();

    const services = resources
      .filter((resource) => {
        if (!needle) return true;
        return [resource.name, resource.url, resource.host, resource.kind, resource.description]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .slice(0, 8)
      .map((resource): PaletteItem => ({ type: "service", resource }));

    const actions = commands
      .filter((command) => !needle || command.label.toLowerCase().includes(needle))
      .map((command): PaletteItem => ({ type: "command", command }));

    return [...services, ...actions];
  }, [query, resources, commands]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) {
    return null;
  }

  function pick(item: PaletteItem) {
    onClose();
    if (item.type === "service") {
      onLaunch(item.resource);
    } else {
      item.command.run();
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(items.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item) pick(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <ModalSurface
      ariaLabel="Command palette"
      backdropClassName="palette-backdrop"
      className="command-palette"
      initialFocusRef={inputRef}
      onClose={onClose}
    >
        <div className="palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search services and actions…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-results" ref={listRef}>
          {items.map((item, index) => {
            const isActive = index === active;

            if (item.type === "service") {
              const status = statusFor(item.resource);
              return (
                <button
                  key={`s-${item.resource.id}`}
                  data-index={index}
                  className={`palette-row ${isActive ? "active" : ""}`}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(item)}
                >
                  <ServiceIcon resource={item.resource} size={24} />
                  <span className="palette-copy">
                    <strong>{item.resource.name}</strong>
                    <small>{serviceAddress(item.resource)}</small>
                  </span>
                  <span className={`svc-dot dot-${status}`} aria-label={status} />
                  {item.resource.url ? <CornerDownLeft size={14} className="palette-enter" /> : null}
                </button>
              );
            }

            return (
              <button
                key={`c-${item.command.id}`}
                data-index={index}
                className={`palette-row palette-command ${isActive ? "active" : ""}`}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(item)}
              >
                <ArrowRight size={16} />
                <span className="palette-copy">
                  <strong>{item.command.label}</strong>
                  {item.command.hint ? <small>{item.command.hint}</small> : null}
                </span>
              </button>
            );
          })}
          {items.length === 0 ? <p className="muted-copy palette-empty">No matches.</p> : null}
        </div>
    </ModalSurface>
  );
}
