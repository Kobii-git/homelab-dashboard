import type { HealthTick } from "../../shared/types";
import { formatDateTime } from "../lib/format";

/**
 * Uptime-Kuma-style heartbeat strip: one bar per recent check result,
 * oldest on the left. Empty slots pad the strip so it keeps a stable width.
 */
export function Heartbeat({
  ticks,
  slots = 24,
  className = ""
}: {
  ticks: HealthTick[];
  slots?: number;
  className?: string;
}) {
  const visible = ticks.slice(-slots);
  const padding = Math.max(0, slots - visible.length);

  if (visible.length === 0) {
    return (
      <div className={`heartbeat is-empty ${className}`.trim()} role="img" aria-label="No checks recorded yet">
        {Array.from({ length: slots }, (_, index) => (
          <span className="hb-tick hb-empty" key={index} />
        ))}
      </div>
    );
  }

  const online = visible.filter((tick) => tick.status === "online").length;
  const offline = visible.filter((tick) => tick.status === "offline").length;
  const unknown = visible.length - online - offline;

  return (
    <div
      className={`heartbeat ${className}`.trim()}
      role="img"
      aria-label={`Last ${visible.length} checks: ${online} online, ${offline} offline${unknown ? `, ${unknown} unknown` : ""}`}
    >
      {Array.from({ length: padding }, (_, index) => (
        <span className="hb-tick hb-empty" key={`pad-${index}`} />
      ))}
      {visible.map((tick) => (
        <span
          key={tick.id}
          className={`hb-tick hb-${tick.status}`}
          title={`${tick.status}${tick.latencyMs != null ? ` · ${tick.latencyMs} ms` : ""} · ${formatDateTime(tick.checkedAt)}`}
        />
      ))}
    </div>
  );
}
