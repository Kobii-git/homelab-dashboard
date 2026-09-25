import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import type { HealthItem, HealthTone } from "../lib/healthPresentation";
export type { HealthItem } from "../lib/healthPresentation";

export function StatusIndicator({ tone, children }: { tone: HealthTone; children: ReactNode }) {
  const Icon = { healthy: CheckCircle2, warning: AlertTriangle, error: AlertCircle, neutral: CircleHelp, loading: LoaderCircle }[tone];
  return <span className={`health-indicator health-${tone}`}><Icon size={15} aria-hidden="true" /><span>{children}</span></span>;
}

export function HealthStrip({ items }: { items: HealthItem[] }) {
  const details = items.flatMap(item => (item.details ?? []).map(detail => ({ ...detail, tone: detail.tone ?? item.tone, key: `${item.id}-${detail.id}` })));
  const announcement = items.map(item => item.label).join(". ");
  return <section className="health-strip" aria-label="Dashboard status">
    <p className="hp-sr-only" role="status" aria-atomic="true">{announcement}</p>
    <div className="health-summary">{items.map(item => <StatusIndicator key={item.id} tone={item.tone}>{item.label}</StatusIndicator>)}</div>
    {details.length > 0 && <details className="health-details">
      <summary>View details <ChevronDown size={14} aria-hidden="true" /></summary>
      <ul>{details.map(detail => <li key={detail.key}>
        <div><StatusIndicator tone={detail.tone}>{detail.label}</StatusIndicator>{detail.description && <p>{detail.description}</p>}</div>
        {detail.onAction && <button className="icon-text-button" type="button" onClick={event => { event.currentTarget.focus(); detail.onAction?.(); }}>{detail.actionLabel ?? "View"}</button>}
      </li>)}</ul>
    </details>}
  </section>;
}
