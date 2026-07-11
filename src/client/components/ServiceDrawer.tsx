import {
  Activity,
  ExternalLink,
  Pencil,
  RefreshCw,
  Star,
  X
} from "lucide-react";
import type { DashboardResource } from "../../shared/types";
import {
  formatDateTime,
  formatUptime,
  latestCheckedAt,
  latestLatency,
  relativeTime,
  resourceTicks,
  serviceAddress,
  statusFor,
  uptimePercent
} from "../lib/format";
import { Heartbeat } from "./Heartbeat";
import { ServiceIcon } from "./ServiceIcon";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./Primitives";
import { ModalSurface } from "./ModalSurface";

export function ServiceDrawer({
  resource,
  checking,
  onClose,
  onOpen,
  onFavorite,
  onRunCheck,
  onEdit
}: {
  resource: DashboardResource;
  checking: boolean;
  onClose: () => void;
  onOpen: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => void;
  onRunCheck: (resource: DashboardResource) => void;
  onEdit: (resource: DashboardResource) => void;
}) {
  const status = statusFor(resource);
  const ticks = resourceTicks(resource, 48);
  const uptime = uptimePercent(resource);
  const latency = latestLatency(resource);
  const checked = latestCheckedAt(resource);
  const checks = resource.healthChecks ?? [];
  const automatic = resource.monitoringMode === "auto";

  return (
    <ModalSurface
      backdropClassName="drawer-backdrop"
      className="service-drawer"
      ariaLabel={`${resource.name} details`}
      onClose={onClose}
    >
        <header className="drawer-head">
          <ServiceIcon resource={resource} size={44} />
          <div className="drawer-title">
            <h2>{resource.name}</h2>
            <small>{serviceAddress(resource)}</small>
          </div>
          <StatusBadge status={status} />
          <button className="icon-button drawer-close" type="button" aria-label={`Close ${resource.name} details`} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="drawer-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!resource.url}
            onClick={() => onOpen(resource)}
          >
            <ExternalLink size={15} /> Open
          </button>
          <button
            className="icon-text-button"
            type="button"
            disabled={!automatic || checking}
            title={automatic ? "Run a health check now" : "Monitoring is not automatic for this service"}
            onClick={() => onRunCheck(resource)}
          >
            {checking ? <RefreshCw size={15} className="spin" /> : <Activity size={15} />} Check now
          </button>
          <button className="icon-text-button" type="button" onClick={() => onEdit(resource)}>
            <Pencil size={15} /> Edit
          </button>
          <button
            className={`icon-button ${resource.favorite ? "is-active" : ""}`}
            type="button"
            title={resource.favorite ? "Remove favorite" : "Favorite"}
            onClick={() => onFavorite(resource)}
          >
            <Star size={15} fill={resource.favorite ? "currentColor" : "none"} />
          </button>
        </div>

        <div className="drawer-stats">
          <span><small>Uptime</small><strong>{formatUptime(uptime)}</strong></span>
          <span><small>Latency</small><strong>{latency != null ? `${latency} ms` : "—"}</strong></span>
          <span><small>Checked</small><strong>{relativeTime(checked)}</strong></span>
          <span><small>Kind</small><strong>{resource.kind}</strong></span>
        </div>

        {automatic ? (
          <section className="drawer-section">
            <h4>Recent checks</h4>
            <Heartbeat ticks={ticks} slots={48} className="heartbeat-lg" />
            <h4>Latency trend</h4>
            <Sparkline ticks={ticks} />
          </section>
        ) : (
          <section className="drawer-section">
            <p className="muted-copy">
              {resource.monitoringMode === "manual"
                ? "Status is set manually for this service."
                : "Monitoring is disabled for this service."}
            </p>
          </section>
        )}

        {checks.length > 0 ? (
          <section className="drawer-section">
            <h4>Health checks</h4>
            <div className="drawer-checks">
              {checks.map((check) => (
                <div className="drawer-check" key={check.id}>
                  <span className={`svc-dot dot-${check.latestStatus}`} />
                  <div className="drawer-check-copy">
                    <strong>{check.type.toUpperCase()} · {check.target}</strong>
                    <small>
                      every {check.intervalSeconds}s · {check.enabled ? "enabled" : "paused"}
                      {check.latestCheckedAt ? ` · ${formatDateTime(check.latestCheckedAt)}` : ""}
                    </small>
                    {check.latestStatus === "offline" && check.latestError ? (
                      <small className="drawer-check-error">{check.latestError}</small>
                    ) : null}
                  </div>
                  {check.latestLatencyMs != null ? <span className="drawer-check-latency">{check.latestLatencyMs} ms</span> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {resource.description ? (
          <section className="drawer-section">
            <h4>Description</h4>
            <p className="muted-copy">{resource.description}</p>
          </section>
        ) : null}
    </ModalSurface>
  );
}
