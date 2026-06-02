import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Gauge,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  Wifi,
  WifiOff
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyPanel, MetricCard, StatusBadge } from "../../components/Primitives";
import type { HealthCheckDto, HealthResultDto, IncidentDto } from "../../lib/api";
import { apiSend } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";

type StatusFilter = "all" | "online" | "offline" | "unknown";

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "offline", label: "Failing" },
  { value: "online", label: "Online" },
  { value: "unknown", label: "Unknown" }
];

function sortResults(results: HealthResultDto[] | undefined): HealthResultDto[] {
  return [...(results ?? [])].sort((left, right) => {
    return new Date(left.checkedAt).getTime() - new Date(right.checkedAt).getTime();
  });
}

function formatLatency(value: number | null | undefined): string {
  if (!value) {
    return "-";
  }

  return `${value} ms`;
}

function summarizeHistory(results: HealthResultDto[]): { uptime: string; averageLatency: string; transitions: number } {
  if (results.length === 0) {
    return { uptime: "No history", averageLatency: "-", transitions: 0 };
  }

  const online = results.filter((result) => result.status === "online").length;
  const latencySamples = results.flatMap((result) => (result.latencyMs ? [result.latencyMs] : []));
  const averageLatency =
    latencySamples.length > 0
      ? `${Math.round(latencySamples.reduce((total, value) => total + value, 0) / latencySamples.length)} ms`
      : "-";
  const transitions = results.reduce((count, result, index) => {
    const previous = results[index - 1];
    return previous && previous.status !== result.status ? count + 1 : count;
  }, 0);

  return {
    uptime: `${Math.round((online / results.length) * 100)}%`,
    averageLatency,
    transitions
  };
}

function MiniHistory({ results }: { results: HealthResultDto[] }) {
  if (results.length === 0) {
    return (
      <div className="history-bars is-empty" aria-label="No check history">
        {Array.from({ length: 10 }, (_, index) => (
          <span className="history-bar bar-unknown" key={index} />
        ))}
      </div>
    );
  }

  const maxLatency = Math.max(...results.map((result) => result.latencyMs ?? 1), 1);

  return (
    <div className="history-bars" aria-label="Check history">
      {results.map((result, index) => {
        const height = result.latencyMs ? Math.max(7, Math.round((result.latencyMs / maxLatency) * 32)) : 10;
        return (
          <span
            className={`history-bar bar-${result.status}`}
            key={`${result.id}-${index}`}
            style={{ height }}
            title={`${result.status} · ${formatLatency(result.latencyMs)} · ${formatDateTime(result.checkedAt)}`}
          />
        );
      })}
    </div>
  );
}

export function MonitoringCenter({
  data,
  onRefresh,
  onInspectIncident
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  onInspectIncident: (incident: IncidentDto) => void;
}) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showDisabled, setShowDisabled] = useState(true);
  const counts = data.checks.reduce(
    (summary, check) => {
      summary[check.latestStatus] += 1;
      return summary;
    },
    { online: 0, offline: 0, unknown: 0 }
  );
  const openIncidents = data.incidents.filter((incident) => incident.status !== "resolved");
  const disabledCount = data.checks.filter((check) => !check.enabled).length;
  const activeMaintenance = data.maintenanceWindows.filter((window) => {
    const now = Date.now();
    return window.enabled && new Date(window.startsAt).getTime() <= now && new Date(window.endsAt).getTime() >= now;
  });
  const upcomingMaintenance = data.maintenanceWindows
    .filter((window) => window.enabled && new Date(window.endsAt).getTime() >= Date.now())
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
    .slice(0, 4);
  const filteredChecks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.checks.filter((check) => {
      const haystack = `${check.resource?.name ?? ""} ${check.type} ${check.target} ${check.latestError ?? ""}`.toLowerCase();
      const matchesQuery = needle.length === 0 || haystack.includes(needle);
      const matchesStatus = statusFilter === "all" || check.latestStatus === statusFilter;
      const matchesEnabled = showDisabled || check.enabled;
      return matchesQuery && matchesStatus && matchesEnabled;
    });
  }, [data.checks, query, showDisabled, statusFilter]);

  async function run(check: HealthCheckDto) {
    setRunningId(check.id);
    try {
      await apiSend(`/api/health-checks/${check.id}/run`, "POST");
      await onRefresh();
    } finally {
      setRunningId(null);
    }
  }

  async function updateIncident(incident: IncidentDto, status: string) {
    await apiSend(`/api/incidents/${incident.id}`, "PATCH", { status });
    await onRefresh();
  }

  return (
    <main className="view-shell">
      <header className="view-header">
        <div>
          <h2>Monitoring</h2>
          <span>{data.checks.length} checks · {openIncidents.length} active incidents · {disabledCount} paused</span>
        </div>
        <div className="header-actions">
          <label className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter checks" />
          </label>
          <button className="icon-text-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <section className="dashboard-overview">
        <MetricCard icon={<Wifi size={18} />} label="Online checks" value={counts.online} tone="online" />
        <MetricCard icon={<WifiOff size={18} />} label="Failing checks" value={counts.offline} tone="offline" />
        <MetricCard icon={<Clock3 size={18} />} label="Pending checks" value={counts.unknown} />
        <MetricCard icon={<Bell size={18} />} label="Open incidents" value={openIncidents.length} tone="offline" />
        <MetricCard icon={<PauseCircle size={18} />} label="Paused checks" value={disabledCount} />
        <MetricCard icon={<CalendarClock size={18} />} label="Maintenance" value={activeMaintenance.length || upcomingMaintenance.length} />
      </section>

      <section className="monitor-controls">
        <div className="segmented-control" aria-label="Check status filter">
          {statusFilters.map((filter) => (
            <button
              className={statusFilter === filter.value ? "active" : ""}
              type="button"
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="checkbox-row monitor-toggle">
          <input type="checkbox" checked={showDisabled} onChange={(event) => setShowDisabled(event.target.checked)} />
          Show paused checks
        </label>
      </section>

      <section className="split-grid">
        <section className="table-panel">
          <h3>Incidents</h3>
          <div className="row-list">
            {openIncidents.map((incident) => (
              <div className="data-row incident-row" key={incident.id}>
                <span>
                  <strong>{incident.title}</strong>
                  <small>
                    {incident.status} · {incident.severity} · {formatDateTime(incident.openedAt)}
                  </small>
                </span>
                <button className="icon-button" type="button" title="Inspect" onClick={() => onInspectIncident(incident)}>
                  <Activity size={15} />
                </button>
                <button className="icon-button" type="button" title="Acknowledge" onClick={() => updateIncident(incident, "acknowledged")}>
                  <CheckCircle2 size={15} />
                </button>
                <button className="icon-button" type="button" title="Resolve" onClick={() => updateIncident(incident, "resolved")}>
                  <Check size={15} />
                </button>
              </div>
            ))}
            {openIncidents.length === 0 ? <p className="muted-copy">No active incidents.</p> : null}
          </div>
        </section>

        <section className="table-panel">
          <h3>Maintenance</h3>
          <div className="row-list">
            {upcomingMaintenance.map((window) => (
              <div className="data-row data-row-wide" key={window.id}>
                <span>
                  <strong>{window.name}</strong>
                  <small>{formatDateTime(window.startsAt)} to {formatDateTime(window.endsAt)}</small>
                </span>
                {window.enabled ? <StatusBadge status="online" /> : <StatusBadge status="unknown" />}
              </div>
            ))}
            {upcomingMaintenance.length === 0 ? <p className="muted-copy">No active or upcoming windows.</p> : null}
          </div>
        </section>
      </section>

      <section className="table-panel alert-delivery-panel">
        <div className="section-heading">
          <h3>Alert Deliveries</h3>
          <span>{data.alertDeliveries.length}</span>
        </div>
        <div className="delivery-strip">
          {data.alertDeliveries.slice(0, 8).map((delivery) => (
            <div className={`delivery-pill delivery-${delivery.status}`} key={delivery.id}>
              <Bell size={14} />
              <span>
                <strong>{delivery.event}</strong>
                <small>{delivery.status} · {formatDateTime(delivery.createdAt)}</small>
              </span>
            </div>
          ))}
          {data.alertDeliveries.length === 0 ? <p className="muted-copy">No alert deliveries yet.</p> : null}
        </div>
      </section>

      <section className="table-panel">
        <div className="section-heading">
          <h3>Checks</h3>
          <span>{filteredChecks.length} visible</span>
        </div>
        <div className="monitor-card-grid">
          {filteredChecks.map((check) => {
            const results = sortResults(check.results);
            const history = summarizeHistory(results);
            return (
              <article className={`monitor-card check-${check.latestStatus} ${check.enabled ? "" : "is-paused"}`} key={check.id}>
                <div className="monitor-card-main">
                  <div>
                    <div className="check-title-row">
                      {check.latestStatus === "offline" ? <AlertTriangle size={18} /> : <Gauge size={18} />}
                      <h3>{check.resource?.name ?? check.target}</h3>
                    </div>
                    <p>
                      {check.type.toUpperCase()} · {check.target}
                    </p>
                    {check.latestError ? <small className="error-copy">{check.latestError}</small> : null}
                  </div>
                  <div className="check-chip-row">
                    <StatusBadge status={check.latestStatus} />
                    <span className={check.enabled ? "check-chip" : "check-chip chip-paused"}>
                      {check.enabled ? "scheduled" : "paused"}
                    </span>
                    <span className="check-chip">every {check.intervalSeconds}s</span>
                  </div>
                  <MiniHistory results={results} />
                </div>
                <div className="monitor-card-stats">
                  <span>
                    <small>Latest</small>
                    <strong>{formatLatency(check.latestLatencyMs)}</strong>
                  </span>
                  <span>
                    <small>Average</small>
                    <strong>{history.averageLatency}</strong>
                  </span>
                  <span>
                    <small>History up</small>
                    <strong>{history.uptime}</strong>
                  </span>
                  <span>
                    <small>Transitions</small>
                    <strong>{history.transitions}</strong>
                  </span>
                  <span>
                    <small>Last check</small>
                    <strong>{formatDateTime(check.latestCheckedAt)}</strong>
                  </span>
                  <span>
                    <small>Failure count</small>
                    <strong>{check.consecutiveFailures ?? 0}/{check.failureThreshold ?? 1}</strong>
                  </span>
                </div>
                <button className="icon-button monitor-run-button" type="button" title="Run" onClick={() => run(check)}>
                  {runningId === check.id ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
                </button>
              </article>
            );
          })}
          {filteredChecks.length === 0 ? (
            <EmptyPanel
              icon={<Activity size={34} />}
              title="No checks match"
              body="Adjust the filters or create HTTP, TCP, or ping checks in Inventory."
            />
          ) : null}
          {data.checks.length === 0 ? (
            <EmptyPanel
              icon={<Activity size={34} />}
              title="No monitoring yet"
              body="Create HTTP, TCP, or ping checks in Inventory to light this board up."
            />
          ) : null}
        </div>
      </section>

      <section className="table-panel">
        <div className="section-heading">
          <h3>Incident History</h3>
          <span>{data.incidents.length}</span>
        </div>
        <div className="timeline-list">
          {[...data.incidents]
            .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
            .slice(0, 20)
            .map((incident) => (
              <div className="timeline-row incident-timeline-row" key={incident.id}>
                <span>{formatDateTime(incident.openedAt)}</span>
                <strong>{incident.title}</strong>
                <p>{incident.summary ?? `${incident.failureCount} consecutive failures`}</p>
                <span className={`status-badge ${incident.status === "resolved" ? "status-online" : incident.status === "open" ? "status-offline" : ""}`}>
                  {incident.status}
                </span>
              </div>
            ))}
          {data.incidents.length === 0 ? <p className="muted-copy">No incident history.</p> : null}
        </div>
      </section>
    </main>
  );
}
