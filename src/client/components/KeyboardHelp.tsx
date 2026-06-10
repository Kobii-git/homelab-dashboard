import { Keyboard, X } from "lucide-react";

const shortcuts = [
  { keys: "Ctrl K", action: "Open command palette" },
  { keys: "/", action: "Open command palette" },
  { keys: "R", action: "Refresh data" },
  { keys: "N", action: "Go to Services" },
  { keys: "?", action: "Show keyboard shortcuts" },
  { keys: "Esc", action: "Close palette or drawer" }
];

export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="keyboard-help" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(event) => event.stopPropagation()}>
        <div className="keyboard-help-header">
          <Keyboard size={18} />
          <h3>Keyboard shortcuts</h3>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="keyboard-help-list">
          {shortcuts.map((item) => (
            <div className="keyboard-help-row" key={item.keys}>
              <kbd>{item.keys}</kbd>
              <span>{item.action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
