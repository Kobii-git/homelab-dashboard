import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Gauge,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { EmptyPanel, MetricCard, PageHeader, StatusBadge } from "../../components/Primitives";
import type { HealthCheckDto, HealthResultDto, IncidentDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
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
  return [...(results ?? [])].sort((a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime());
}

function formatLatency(value: number | null | undefined): string {
  return value ? `${value} ms` : "-";
}

function summarizeHistory(results: HealthResultDto[]) {
  if (results.length === 0) return { uptime: "No history", averageLatency: "-", transitions: 0 };
  const online = results.filter((r) => r.status === "online").length;
  const latencySamples = results.flatMap((r) => (r.latencyMs ? [r.latencyMs] : []));
  const averageLatency =
    latencySamples.length > 0
      ? `${Math.round(latencySamples.reduce((t, v) => t + v, 0) / latencySamples.length)} ms`
      : "-";
  const transitions = results.reduce((count, r, i) => {
    const prev = results[i - 1];
    return prev && prev.status !== r.status ? count + 1 : count;
  }, 0);
  return { uptime: `${Math.round((online / results.length) * 100)}%`, averageLatency, transitions };
}

function MiniHistory({ results }: { results: HealthResultDto[] }) {
  if (results.length === 0) {
    return (
      <div className="history-bars is-empty" aria-label="No check history">
        {Array.from({ length: 10 }, (_, i) => <span className="history-bar bar-unknown" key={i} />)}
      </div>
    );
  }
  const maxLatency = Math.max(...results.map((r) => r.latencyMs ?? 1), 1);
  return (
    <div className="history-bars" aria-label="Check history">
      {results.map((result, i) => {
        const height = result.latencyMs ? Math.max(7, Math.round((result.latencyMs / maxLatency) * 32)) : 10;
        return (
          <span
            className={`history-bar bar-${result.status}`}
            key={`${result.id}-${i}`}
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
  onInspectIncident,
  onOpenServicesChecks
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  onInspectIncident: (incident: IncidentDto) => void;
  onOpenServicesChecks?: () => void;
}) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showDisabled, setShowDisabled] = useState(true);
  const [muteTarget, setMuteTarget] = useState<IncidentDto | null>(null);
  const [muteUntil, setMuteUntil] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const counts = data.checks.reduce(
    (s, c) => { s[c.latestStatus] += 1; return s; },
    { online: 0, offline: 0, unknown: 0 }
  );
  const openIncidents = data.incidents.filter((i) => i.status !== "resolved");
  const disabledCount = data.checks.filter((c) => !c.enabled).length;
  const activeMaintenance = data.maintenanceWindows.filter((w) => {
    const now = Date.now();
    return w.enabled && new Date(w.startsAt).getTime() <= now && new Date(w.endsAt).getTime() >= now;
  });
  const upcomingMaintenance = data.maintenanceWindows
    .filter((w) => w.enabled && new Date(w.endsAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 8);

  const filteredChecks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.checks.filter((c) => {
      const hay = `${c.resource?.name ?? ""} ${c.type} ${c.target} ${c.latestError ?? ""}`.toLowerCase();
      return (needle.length === 0 || hay.includes(needle)) &&
        (statusFilter === "all" || c.latestStatus === statusFilter) &&
        (showDisabled || c.enabled);
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

  async function toggleCheck(check: HealthCheckDto) {
    await apiSend(`/api/health-checks/${check.id}`, "PATCH", { enabled: !check.enabled });
    await onRefresh();
  }

  async function updateIncident(incident: IncidentDto, status: string) {
    await apiSend(`/api/incidents/${incident.id}`, "PATCH", { status });
    await onRefresh();
  }

  async function muteIncident(event: FormEvent) {
    event.preventDefault();
    if (!muteTarget || !muteUntil) return;
    await apiSend(`/api/incidents/${muteTarget.id}`, "PATCH", {
      status: "muted",
      mutedUntil: new Date(muteUntil).toISOString()
    });
    setMuteTarget(null);
    setMuteUntil("");
    await onRefresh();
  }

  async function deleteIncident(id: string) {
    if (!window.confirm("Delete this incident record?")) return;
    await apiSend(`/api/incidents/${id}`, "DELETE");
    await onRefresh();
  }

  async function createMaintenanceWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      await apiSend("/api/maintenance-windows", "POST", {
        name: emptyToNull(form.get("name")),
        startsAt: new Date(String(form.get("startsAt"))).toISOString(),
        endsAt: new Date(String(form.get("endsAt"))).toISOString(),
        notes: emptyToNull(form.get("notes")),
        enabled: true
      });
      formElement.reset();
      await onRefresh();
    }, setActionError, setSubmitting, "Maintenance window added");
  }

  async function deleteMaintenanceWindow(id: string, name: string) {
    if (!window.confirm(`Delete maintenance window "${name}"?`)) return;
    await apiSend(`/api/maintenance-windows/${id}`, "DELETE");
    await onRefresh();
  }

  return (
    <main className="view-shell">
      <PageHeader
        title="Monitoring"
        subtitle={`${data.checks.length} checks · ${openIncidents.length} active incidents · ${disabledCount} paused`}
        actions={
          <>
            <label className="search-box">
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter checks" />
            </label>
            <button className="icon-text-button" type="button" onClick={onRefresh}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </>
        }
      />

      <FormErrorBanner message={actionError} />

      <section className="dashboard-overview">
        <MetricCard icon={<Wifi size={18} />} label="Online checks" value={counts.online} tone="online" />
        <MetricCard icon={<WifiOff size={18} />} label="Failing checks" value={counts.offline} tone="offline" />
        <MetricCard icon={<Clock3 size={18} />} label="Pending checks" value={counts.unknown} />
        <MetricCard icon={<Bell size={18} />} label="Open incidents" value={openIncidents.length} tone={openIncidents.length ? "offline" : "neutral"} />
        <MetricCard icon={<PauseCircle size={18} />} label="Paused checks" value={disabledCount} />
        <MetricCard icon={<CalendarClock size={18} />} label="Maintenance" value={activeMaintenance.length || upcomingMaintenance.length} />
      </section>

      <section className="monitor-controls">
        <div className="segmented-control" aria-label="Check status filter">
          {statusFilters.map((f) => (
            <button className={statusFilter === f.value ? "active" : ""} type="button" key={f.value} onClick={() => setStatusFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="checkbox-row monitor-toggle">
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          Show paused checks
        </label>
      </section>

      <section className="split-grid">
        <section className="table-panel">
          <h3>Active Incidents</h3>
          {muteTarget ? (
            <form className="mute-picker" onSubmit={muteIncident}>
              <span>Mute <strong>{muteTarget.title}</strong> until:</span>
              <input
                type="datetime-local"
                value={muteUntil}
                onChange={(e) => setMuteUntil(e.target.value)}
                required
              />
              <div className="mute-actions">
                <button className="primary-button" type="submit" style={{ width: "auto", padding: "0 14px" }}>
                  <BellOff size={14} /> Mute
                </button>
                <button className="icon-text-button" type="button" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }} onClick={() => setMuteTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          <div className="row-list">
            {openIncidents.map((incident) => (
              <div className="data-row incident-row" key={incident.id}>
                <span>
                  <strong>{incident.title}</strong>
                  <small>{incident.status} · {incident.severity} · {formatDateTime(incident.openedAt)}</small>
                </span>
                <button className="icon-button" type="button" title="Inspect" onClick={() => onInspectIncident(incident)}>
                  <Activity size={14} />
                </button>
                <button className="icon-button" type="button" title="Acknowledge" onClick={() => updateIncident(incident, "acknowledged")}>
                  <CheckCircle2 size={14} />
                </button>
                <button className="icon-button" type="button" title="Resolve" onClick={() => updateIncident(incident, "resolved")}>
                  <Check size={14} />
                </button>
                <button className="icon-button" type="button" title="Mute" onClick={() => { setMuteTarget(incident); setMuteUntil(""); }}>
                  <BellOff size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => deleteIncident(incident.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {openIncidents.length === 0 ? (
              <EmptyPanel compact icon={<CheckCircle2 size={18} />} title="No active incidents" body="All clear — incidents will appear here when checks fail." />
            ) : null}
          </div>
        </section>

        <section className="table-panel">
          <h3>Maintenance Windows</h3>
          <form className="inline-form" style={{ marginBottom: 14 }} onSubmit={createMaintenanceWindow}>
            <label>Name<input name="name" required placeholder="e.g. Weekly patch window" /></label>
            <div className="split-grid" style={{ gap: 8, marginBottom: 0 }}>
              <label>Starts<input name="startsAt" type="datetime-local" required /></label>
              <label>Ends<input name="endsAt" type="datetime-local" required /></label>
            </div>
            <label>Notes<input name="notes" placeholder="Optional" /></label>
            <button className="primary-button" type="submit">
              <Plus size={15} /> Add window
            </button>
          </form>
          <div className="row-list">
            {upcomingMaintenance.map((w) => (
              <div className="data-row data-row-wide" key={w.id}>
                <span>
                  <strong>{w.name}</strong>
                  <small>{formatDateTime(w.startsAt)} → {formatDateTime(w.endsAt)}</small>
                </span>
                {w.enabled ? <StatusBadge status="online" /> : <StatusBadge status="unknown" />}
                <button className="icon-button danger" type="button" title="Delete" onClick={() => deleteMaintenanceWindow(w.id, w.name)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {upcomingMaintenance.length === 0 ? <p className="muted-copy">No upcoming maintenance windows.</p> : null}
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
                    <p>{check.type.toUpperCase()} · {check.target}</p>
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
                  <span><small>Latest</small><strong>{formatLatency(check.latestLatencyMs)}</strong></span>
                  <span><small>Average</small><strong>{history.averageLatency}</strong></span>
                  <span><small>Uptime</small><strong>{history.uptime}</strong></span>
                  <span><small>Transitions</small><strong>{history.transitions}</strong></span>
                  <span><small>Last check</small><strong>{formatDateTime(check.latestCheckedAt)}</strong></span>
                  <span><small>Failures</small><strong>{check.consecutiveFailures ?? 0}/{check.failureThreshold ?? 1}</strong></span>
                </div>
                <div className="monitor-card-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title={check.enabled ? "Pause" : "Resume"}
                    onClick={() => toggleCheck(check)}
                  >
                    {check.enabled ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                  </button>
                  <button className="icon-button monitor-run-button" type="button" title="Run now" onClick={() => run(check)}>
                    {runningId === check.id ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
                  </button>
                </div>
              </article>
            );
          })}
          {filteredChecks.length === 0 ? (
            <EmptyPanel
              icon={<Activity size={34} />}
              title={data.checks.length === 0 ? "No health checks yet" : "No checks match"}
              body={
                data.checks.length === 0
                  ? "Create HTTP, TCP, ping, or SSL checks under Services -> Checks. Checks run automatically every minute once added."
                  : "Adjust the filters or create checks in Services."
              }
              action={
                onOpenServicesChecks ? (
                  <button className="primary-button" type="button" onClick={onOpenServicesChecks}>
                    <Plus size={15} />
                    Add check in Services
                  </button>
                ) : undefined
              }
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
