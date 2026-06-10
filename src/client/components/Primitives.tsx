import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Activity, RefreshCw, Wifi, WifiOff } from "lucide-react";

export function InlineSpinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <RefreshCw className={`ds-spinner ${className}`.trim()} size={size} aria-hidden />;
}

/* ── Layout ───────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
  className = ""
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`ds-page-header ${className}`.trim()}>
      <div className="ds-page-header-copy">
        <h2>{title}</h2>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {actions ? <div className="ds-page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  count,
  action
}: {
  title: string;
  count?: string | number;
  action?: ReactNode;
}) {
  return (
    <div className="ds-section-header">
      <h3>{title}</h3>
      <div className="ds-section-header-meta">
        {count != null ? <span className="ds-count">{count}</span> : null}
        {action}
      </div>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ds-panel ${className}`.trim()}>{children}</section>;
}

export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ds-toolbar ${className}`.trim()}>{children}</div>;
}

/* ── Buttons ─────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "subtle" | "danger";
type ButtonSize = "sm" | "md";

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      className={`ds-btn ds-btn-${variant} ds-btn-${size} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`ds-icon-btn ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

/* ── Form fields ─────────────────────────────────────────────────── */

export function Field({
  label,
  error,
  children,
  className = ""
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`ds-field ${error ? "has-error" : ""} ${className}`.trim()}>
      <span className="ds-field-label">{label}</span>
      {children}
      {error ? <span className="ds-field-error">{error}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ds-input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ds-input ds-select" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="ds-input ds-textarea" {...props} />;
}

/* ── Status & metrics ────────────────────────────────────────────── */

export function StatusPill({
  status,
  label
}: {
  status: "online" | "offline" | "unknown" | "connected" | "failed" | "launching" | "neutral";
  label?: string;
}) {
  const text = label ?? status;
  return <span className={`ds-pill ds-pill-${status}`}>{text}</span>;
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
      <div className="metric-copy">
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

/* ── Empty state ─────────────────────────────────────────────────── */

export function EmptyPanel({
  icon,
  title,
  body,
  action,
  compact = false
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`empty-panel ${compact ? "empty-panel-compact" : ""}`.trim()}>
      <div className="empty-panel-icon">{icon}</div>
      <div className="empty-panel-copy">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      {action ? <div className="empty-panel-action">{action}</div> : null}
    </section>
  );
}

/* ── Tabs chip ───────────────────────────────────────────────────── */

export function TabChip({
  active,
  failed,
  icon,
  title,
  statusLabel,
  onSelect,
  onClose
}: {
  active: boolean;
  failed?: boolean;
  icon: ReactNode;
  title: string;
  statusLabel: string;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      className={`session-tab-chip ${active ? "active" : ""} ${failed ? "failed" : ""}`.trim()}
      onClick={onSelect}
    >
      {icon}
      <span className={`session-state-dot dot-${failed ? "error" : active ? "connected" : "connecting"}`} />
      <span className="session-tab-chip-title">{title}</span>
      <span className="session-tab-chip-pill">{statusLabel}</span>
      <span
        className="session-tab-chip-close"
        role="button"
        tabIndex={-1}
        aria-label={`Close ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        ×
      </span>
    </button>
  );
}
