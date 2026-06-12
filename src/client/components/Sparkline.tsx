import { useMemo } from "react";
import type { HealthTick } from "../../shared/types";

/**
 * Latency-over-time SVG sparkline. Offline samples break the line so
 * outages read as gaps instead of fake zero-latency points.
 */
export function Sparkline({
  ticks,
  width = 360,
  height = 64
}: {
  ticks: HealthTick[];
  width?: number;
  height?: number;
}) {
  const { segments, max } = useMemo(() => {
    const values = ticks.map((tick) => (tick.status === "online" ? tick.latencyMs : null));
    const known = values.filter((value): value is number => value != null);
    const top = Math.max(1, ...known);
    const stepX = ticks.length > 1 ? width / (ticks.length - 1) : width;
    const pad = 6;
    const usable = height - pad * 2;

    const lines: string[] = [];
    let current: string[] = [];

    values.forEach((value, index) => {
      if (value == null) {
        if (current.length > 0) lines.push(current.join(" "));
        current = [];
        return;
      }
      const x = Math.round(index * stepX * 10) / 10;
      const y = Math.round((pad + usable * (1 - value / top)) * 10) / 10;
      current.push(`${x},${y}`);
    });

    if (current.length > 0) lines.push(current.join(" "));

    return { segments: lines, max: known.length > 0 ? Math.max(...known) : null };
  }, [ticks, width, height]);

  if (max == null) {
    return <p className="muted-copy">No latency samples yet.</p>;
  }

  return (
    <div className="sparkline-wrap">
      <svg
        className="sparkline"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Latency trend, peaking at ${max} ms`}
      >
        {segments.map((points, index) => (
          <polyline key={index} points={points} fill="none" />
        ))}
      </svg>
      <span className="sparkline-max">{max} ms peak</span>
    </div>
  );
}
