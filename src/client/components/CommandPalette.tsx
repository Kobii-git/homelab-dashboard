import { Activity, ExternalLink, Monitor, Search, Server, Shield, TerminalSquare, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { SearchResultDto } from "../lib/api";
import { apiGet } from "../lib/api";

const iconByType: Record<string, ReactNode> = {
  resource: <Server size={16} />,
  connection: <TerminalSquare size={16} />,
  check: <Activity size={16} />,
  incident: <Activity size={16} />,
  credential: <Shield size={16} />,
  navigation: <Monitor size={16} />,
  action: <ExternalLink size={16} />
};

export function CommandPalette({
  open,
  onClose,
  onAction
}: {
  open: boolean;
  onClose: () => void;
  onAction: (result: SearchResultDto) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultDto[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void apiGet<SearchResultDto[]>(`/api/search?q=${encodeURIComponent(query)}&limit=18`).then((next) => {
        if (!cancelled) {
          setResults(next);
          setActiveIndex(0);
        }
      });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  const active = useMemo(() => results[activeIndex], [activeIndex, results]);

  if (!open) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder="Search resources, sessions, checks, incidents..."
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(results.length - 1, index + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              }
              if (event.key === "Enter" && active) {
                onAction(active);
              }
            }}
          />
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="palette-results">
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              className={`palette-row ${index === activeIndex ? "active" : ""}`}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onAction(result)}
            >
              {iconByType[result.type] ?? <Search size={16} />}
              <span>
                <strong>{result.title}</strong>
                <small>{result.subtitle}</small>
              </span>
              <kbd>{result.action}</kbd>
            </button>
          ))}
          {results.length === 0 ? <p className="muted-copy">No commands found.</p> : null}
        </div>
      </section>
    </div>
  );
}
