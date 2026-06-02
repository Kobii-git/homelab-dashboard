import type { ReactNode } from "react";
import { Activity, Wifi, WifiOff } from "lucide-react";

export function MetricCard({
  icon,
  label,
  value,
  tone = "neutral"
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: "neutral" | "online" | "offline" | "accent";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

export function StatusBadge({ status }: { status: "unknown" | "online" | "offline" }) {
  const Icon = status === "online" ? Wifi : status === "offline" ? WifiOff : Activity;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={14} />
      {status}
    </span>
  );
}

export function EmptyPanel({
  icon,
  title,
  body,
  action
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="empty-panel">
      {icon}
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      {action}
    </section>
  );
}
