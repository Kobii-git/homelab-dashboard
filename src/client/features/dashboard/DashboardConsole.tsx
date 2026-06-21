import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cpu,
  ExternalLink,
  HardDrive,
  Info,
  LayoutGrid,
  MemoryStick,
  Network,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Server,
  Star,
  Thermometer,
  X
} from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { DashboardResource, HostMetricSampleDto, HostMonitorDto } from "../../../shared/types";
import { EmptyPanel, StatusBadge } from "../../components/Primitives";
import { Heartbeat } from "../../components/Heartbeat";
import { ServiceDrawer } from "../../components/ServiceDrawer";
import { ServiceIcon } from "../../components/ServiceIcon";
import {
  dashboardResources,
  formatByteRate,
  formatBytes,
  formatPercent,
  formatUptime,
  greetingFor,
  latestCheckedAt,
  latestErrors,
  latestLatency,
  relativeTime,
  resourceTicks,
  serviceAddress,
  statusFor,
  summarizeResourceStatus,
  uptimePercent
} from "../../lib/format";
import { apiGet } from "../../lib/api";
import { type AppData } from "../types";

type StatusFilter = "all" | "favorites" | "online" | "offline" | "unknown";
type Density = "grid" | "list";

const DENSITY_KEY = "homelab-density";

function readDensity(): Density {
  return localStorage.getItem(DENSITY_KEY) === "list" ? "list" : "grid";
}

function monitoringLabel(resource: DashboardResource): string {
  if (resource.monitoringMode === "disabled") return "off";
  if (resource.monitoringMode === "manual") return "manual";
  const latency = latestLatency(resource);
  return latency == null ? "—" : `${latency} ms`;
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

type DragState = { id: string; container: string } | null;
type MetricKey = "cpuPercent" | "memoryPercent" | "diskPercent";

function metricLevel(value: number | null | undefined): "ok" | "warn" | "critical" | "unknown" {
  if (value == null) return "unknown";
  if (value >= 90) return "critical";
  if (value >= 80) return "warn";
  return "ok";
}

function sortSamples(samples: HostMetricSampleDto[] | undefined): HostMetricSampleDto[] {
  return [...(samples ?? [])].sort((left, right) => left.sampledAt.localeCompare(right.sampledAt));
}

function MetricSparkline({ samples, metric }: { samples: HostMetricSampleDto[] | undefined; metric: MetricKey }) {
  const values = sortSamples(samples)
    .map((sample) => sample[metric])
    .filter((value): value is number => typeof value === "number");

  if (values.length < 2) {
    return <div className="metric-sparkline metric-sparkline-empty" aria-hidden />;
  }

  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 36 - (Math.max(0, Math.min(100, value)) / 100) * 32;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="metric-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function MetricBar({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: number | null | undefined;
  detail?: string;
}) {
  const percent = value == null ? 0 : Math.max(0, Math.min(100, value));
  const level = metricLevel(value);

  return (
    <div className={`metric-row metric-${level}`}>
      <span className="metric-row-label">{icon}<span>{label}</span></span>
      <strong>{formatPercent(value)}</strong>
      <div className="metric-bar" aria-hidden><i style={{ width: `${percent}%` }} /></div>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function HostVitalsCard({ host, onInspect }: { host: HostMonitorDto; onInspect: (host: HostMonitorDto) => void }) {
  const samples = sortSamples(host.samples);
  const latestSample = samples[samples.length - 1];
  const status = host.latestStatus;
  const updated = host.latestSampledAt ?? latestSample?.sampledAt ?? null;
  const networkTotal = (host.latestNetworkRxBytesPerSec ?? 0) + (host.latestNetworkTxBytesPerSec ?? 0);

  return (
    <article
      className={`host-card host-${status}`}
      role="button"
      tabIndex={0}
      title={`Inspect ${host.name} metrics`}
      onClick={() => onInspect(host)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onInspect(host);
        }
      }}
    >
      <header className="host-card-head">
        <span className="host-icon"><Server size={18} /></span>
        <span>
          <strong>{host.name}</strong>
          <small>{host.baseUrl}</small>
        </span>
        <i className={`svc-dot dot-${status}`} title={status} />
      </header>

      <div className="host-spark-grid">
        <MetricSparkline samples={host.samples} metric="cpuPercent" />
        <MetricSparkline samples={host.samples} metric="memoryPercent" />
        <MetricSparkline samples={host.samples} metric="diskPercent" />
      </div>

      <div className="host-metrics">
        <MetricBar icon={<Cpu size={13} />} label="CPU" value={host.latestCpuPercent} />
        <MetricBar
          icon={<MemoryStick size={13} />}
          label="RAM"
          value={host.latestMemoryPercent}
          detail={`${formatBytes(host.latestMemoryUsedBytes)} / ${formatBytes(host.latestMemoryTotalBytes)}`}
        />
        <MetricBar
          icon={<HardDrive size={13} />}
          label={host.primaryMount}
          value={host.latestDiskPercent}
          detail={`${formatBytes(host.latestDiskUsedBytes)} / ${formatBytes(host.latestDiskTotalBytes)}`}
        />
      </div>

      <footer className="host-card-foot">
        <span title="Network throughput"><Network size={13} /> {formatByteRate(networkTotal || null)}</span>
        {host.latestTemperatureC != null ? <span title="Temperature"><Thermometer size={13} /> {host.latestTemperatureC.toFixed(1)}°C</span> : null}
        {host.latestContainersTotal != null ? <span title="Containers"><Activity size={13} /> {host.latestContainersRunning ?? 0}/{host.latestContainersTotal}</span> : null}
        <span title="Last sampled">{relativeTime(updated)}</span>
      </footer>

      {status === "offline" && host.latestError ? <p className="host-error">{host.latestError}</p> : null}
    </article>
  );
}

function NetworkSparkline({ samples }: { samples: HostMetricSampleDto[] | undefined }) {
  const values = sortSamples(samples)
    .map((sample) => (sample.networkRxBytesPerSec ?? 0) + (sample.networkTxBytesPerSec ?? 0))
    .filter((value) => value > 0);

  if (values.length < 2) {
    return <div className="metric-sparkline metric-sparkline-empty" aria-hidden />;
  }

  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 36 - (Math.max(0, Math.min(max, value)) / max) * 32;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="metric-sparkline host-detail-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function HostDetailDrawer({
  host,
  loading,
  error,
  onClose
}: {
  host: HostMonitorDto;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const samples = sortSamples(host.samples);
  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  const networkTotal = (host.latestNetworkRxBytesPerSec ?? 0) + (host.latestNetworkTxBytesPerSec ?? 0);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <aside className="service-drawer host-detail-drawer" role="dialog" aria-label={`${host.name} host metrics`}>
        <header className="drawer-head">
          <span className="host-icon"><Server size={20} /></span>
          <div className="drawer-title">
            <h2>{host.name}</h2>
            <small>{host.baseUrl}</small>
          </div>
          <StatusBadge status={host.latestStatus} />
          <button className="icon-button drawer-close" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="drawer-stats">
          <span><small>CPU</small><strong>{formatPercent(host.latestCpuPercent)}</strong></span>
          <span><small>RAM</small><strong>{formatPercent(host.latestMemoryPercent)}</strong></span>
          <span><small>Disk</small><strong>{formatPercent(host.latestDiskPercent)}</strong></span>
          <span><small>Network</small><strong>{formatByteRate(networkTotal || null)}</strong></span>
        </div>

        {loading ? <p className="muted-copy">Loading 24h host history...</p> : null}
        {error ? <div className="app-error">{error}</div> : null}

        <section className="drawer-section host-detail-section">
          <h4>24h trends</h4>
          <div className="host-detail-trends">
            <div>
              <span><Cpu size={14} /> CPU</span>
              <MetricSparkline samples={samples} metric="cpuPercent" />
            </div>
            <div>
              <span><MemoryStick size={14} /> RAM</span>
              <MetricSparkline samples={samples} metric="memoryPercent" />
            </div>
            <div>
              <span><HardDrive size={14} /> Disk</span>
              <MetricSparkline samples={samples} metric="diskPercent" />
            </div>
            <div>
              <span><Network size={14} /> Network</span>
              <NetworkSparkline samples={samples} />
            </div>
          </div>
        </section>

        <section className="drawer-section">
          <h4>Latest sample</h4>
          <div className="key-value-grid host-detail-grid">
            <span><span>Collected</span><strong>{relativeTime(host.latestSampledAt ?? newest?.sampledAt ?? null)}</strong></span>
            <span><span>Range</span><strong>{oldest ? `${relativeTime(oldest.sampledAt)} to now` : "No history"}</strong></span>
            <span><span>Memory</span><strong>{formatBytes(host.latestMemoryUsedBytes)} / {formatBytes(host.latestMemoryTotalBytes)}</strong></span>
            <span><span>Disk {host.primaryMount}</span><strong>{formatBytes(host.latestDiskUsedBytes)} / {formatBytes(host.latestDiskTotalBytes)}</strong></span>
            <span><span>Containers</span><strong>{host.latestContainersTotal == null ? "—" : `${host.latestContainersRunning ?? 0}/${host.latestContainersTotal}`}</strong></span>
            <span><span>Temperature</span><strong>{host.latestTemperatureC == null ? "—" : `${host.latestTemperatureC.toFixed(1)}°C`}</strong></span>
          </div>
          {host.latestError ? <p className="drawer-check-error">{host.latestError}</p> : null}
        </section>
      </aside>
    </>
  );
}

function ServiceCard({
  resource,
  density,
  checking,
  draggable,
  dragging,
  onOpen,
  onInspect,
  onFavorite,
  onRunCheck,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  resource: DashboardResource;
  density: Density;
  checking: boolean;
  draggable: boolean;
  dragging: boolean;
  onOpen: (resource: DashboardResource) => void;
  onInspect: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => void;
  onRunCheck: (resource: DashboardResource) => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const status = statusFor(resource);
  const ticks = resourceTicks(resource, density === "grid" ? 22 : 16);
  const uptime = uptimePercent(resource);
  const checked = latestCheckedAt(resource);
  const automatic = resource.monitoringMode === "auto";

  function activate() {
    if (resource.url) {
      onOpen(resource);
    } else {
      onInspect(resource);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      activate();
    }
  }

  return (
    <article
      className={`svc-card svc-${status} ${dragging ? "is-dragging" : ""}`}
      role="button"
      tabIndex={0}
      title={resource.url ? `Open ${resource.name}` : `Inspect ${resource.name}`}
      draggable={draggable}
      onClick={activate}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <header className="svc-top">
        <ServiceIcon resource={resource} size={density === "grid" ? 40 : 30} />
        <div className="svc-name">
          <strong>{resource.name}</strong>
          <small>{serviceAddress(resource)}</small>
        </div>
        <span className={`svc-dot dot-${status}`} title={status} />
      </header>

      <Heartbeat ticks={ticks} slots={density === "grid" ? 22 : 16} className="svc-heartbeat" />

      <footer className="svc-meta">
        <span className="svc-stat" title="Uptime across recent checks">{formatUptime(uptime)}</span>
        <span className="svc-stat" title="Latest latency">{monitoringLabel(resource)}</span>
        <span className="svc-stat svc-when" title="Last checked">{relativeTime(checked)}</span>

        <span className="svc-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className={`svc-action ${resource.favorite ? "is-active" : ""}`}
            type="button"
            title={resource.favorite ? "Remove favorite" : "Favorite"}
            onClick={() => onFavorite(resource)}
          >
            <Star size={14} fill={resource.favorite ? "currentColor" : "none"} />
          </button>
          {automatic ? (
            <button
              className="svc-action"
              type="button"
              title="Run health check now"
              disabled={checking || (!resource.url && !resource.host)}
              onClick={() => onRunCheck(resource)}
            >
              <RefreshCw size={14} className={checking ? "spin" : ""} />
            </button>
          ) : null}
          <button className="svc-action" type="button" title="Details" onClick={() => onInspect(resource)}>
            <Info size={14} />
          </button>
          {resource.url ? (
            <button className="svc-action" type="button" title="Open in new tab" onClick={() => onOpen(resource)}>
              <ExternalLink size={14} />
            </button>
          ) : null}
        </span>
      </footer>
    </article>
  );
}

export function DashboardConsole({
  data,
  username,
  onRefresh,
  onPatchResource,
  onRunCheck,
  onPatchGroup,
  onOpenServices,
  onOpenSettings,
  onEditService,
  onReorder
}: {
  data: AppData;
  username: string;
  onRefresh: () => Promise<void>;
  onPatchResource: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRunCheck: (resource: DashboardResource) => Promise<void>;
  onPatchGroup: (id: string, body: Record<string, unknown>) => Promise<void>;
  onOpenServices: () => void;
  onOpenSettings: () => void;
  onEditService: (resource: DashboardResource) => void;
  onReorder: (orderedIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [density, setDensity] = useState<Density>(readDensity);
  const [checkingResourceId, setCheckingResourceId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inspectedHostId, setInspectedHostId] = useState<string | null>(null);
  const [hostDetail, setHostDetail] = useState<HostMonitorDto | null>(null);
  const [hostDetailLoading, setHostDetailLoading] = useState(false);
  const [hostDetailError, setHostDetailError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const now = useClock();

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  const resources = useMemo(
    () => dashboardResources(data.dashboard.groups, data.dashboard.ungroupedResources),
    [data.dashboard]
  );
  const hostMonitors = data.dashboard.hostMonitors ?? [];
  const briefing = data.dashboard.dailyBriefing;
  const totals = summarizeResourceStatus(resources);
  const favorites = resources.filter((resource) => resource.favorite);
  const offlineResources = resources.filter((resource) => statusFor(resource) === "offline");
  const inspected = inspectedId ? resources.find((resource) => resource.id === inspectedId) ?? null : null;
  const inspectedHost = inspectedHostId
    ? hostDetail ?? hostMonitors.find((host) => host.id === inspectedHostId) ?? null
    : null;
  const offlineHosts = hostMonitors.filter((host) => host.latestStatus === "offline").length;
  const pressureHosts = briefing.hostsUnderPressure.length;
  const dailyIssueCount =
    offlineResources.length +
    offlineHosts +
    pressureHosts +
    briefing.staleChecks.length +
    briefing.unmonitoredServices.length +
    briefing.watchlist.length;
  const lastUpdatedAt = [
    ...resources.map(latestCheckedAt),
    ...hostMonitors.map((host) => host.latestSampledAt)
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  const filters: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: resources.length },
    { id: "favorites", label: "Favorites", count: totals.favorites },
    { id: "online", label: "Online", count: totals.online },
    { id: "offline", label: "Offline", count: totals.offline },
    { id: "unknown", label: "Unknown", count: totals.unknown }
  ];

  function matchesResource(resource: DashboardResource): boolean {
    const status = statusFor(resource);
    const haystack = [resource.name, resource.url, resource.host, resource.kind, resource.description]
      .join(" ")
      .toLowerCase();
    const matchesQuery = haystack.includes(query.toLowerCase());
    const matchesFilter =
      statusFilter === "all" ||
      (statusFilter === "favorites" ? resource.favorite : status === statusFilter);
    return matchesQuery && matchesFilter;
  }

  const filteredGroups = data.dashboard.groups
    .map((group) => ({ ...group, resources: group.resources.filter(matchesResource) }))
    .filter((group) => group.resources.length > 0 || (!query && statusFilter === "all"));
  const filteredUngrouped = data.dashboard.ungroupedResources.filter(matchesResource);
  const visibleCount =
    filteredGroups.reduce((sum, group) => sum + group.resources.length, 0) + filteredUngrouped.length;

  const reorderEnabled = query === "" && statusFilter === "all";

  useEffect(() => {
    if (!inspectedHostId) {
      setHostDetail(null);
      setHostDetailError(null);
      setHostDetailLoading(false);
      return;
    }

    let active = true;
    setHostDetailLoading(true);
    setHostDetailError(null);

    apiGet<HostMonitorDto>(`/api/metrics/hosts/${inspectedHostId}`)
      .then((host) => {
        if (active) setHostDetail(host);
      })
      .catch((error) => {
        if (active) setHostDetailError(error instanceof Error ? error.message : "Host metrics failed to load");
      })
      .finally(() => {
        if (active) setHostDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [inspectedHostId]);

  function openResource(resource: DashboardResource) {
    if (resource.url) {
      window.open(resource.url, "_blank", "noopener,noreferrer");
    }
  }

  function resourceById(id: string): DashboardResource | null {
    return resources.find((resource) => resource.id === id) ?? null;
  }

  function inspectResource(id: string) {
    setInspectedId(id);
  }

  function editResource(id: string) {
    const resource = resourceById(id);
    if (resource) {
      onEditService(resource);
    }
  }

  function runResourceById(id: string) {
    const resource = resourceById(id);
    if (resource) {
      void runCheck(resource);
    }
  }

  async function runCheck(resource: DashboardResource) {
    setCheckingResourceId(resource.id);
    setCheckError(null);
    try {
      await onRunCheck(resource);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Health check failed");
    } finally {
      setCheckingResourceId(null);
    }
  }

  function handleDrop(containerKey: string, containerIds: string[], targetId: string | null, event: DragEvent) {
    event.preventDefault();
    if (!drag || drag.container !== containerKey) {
      setDrag(null);
      return;
    }

    const withoutDragged = containerIds.filter((id) => id !== drag.id);
    let insertAt = targetId ? withoutDragged.indexOf(targetId) : withoutDragged.length;
    if (insertAt < 0) {
      insertAt = withoutDragged.length;
    } else if (targetId) {
      const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const isAfter = density === "list"
        ? event.clientY > target.top + target.height / 2
        : event.clientX > target.left + target.width / 2;
      if (isAfter) insertAt += 1;
    }

    const next = [...withoutDragged];
    next.splice(insertAt, 0, drag.id);
    setDrag(null);

    if (next.join() !== containerIds.join()) {
      void onReorder(next);
    }
  }

  function renderCards(containerKey: string, items: DashboardResource[]) {
    const ids = items.map((item) => item.id);

    return (
      <div
        className={`svc-collection density-${density}`}
        onDragOver={(event) => {
          if (drag?.container === containerKey) event.preventDefault();
        }}
        onDrop={(event) => handleDrop(containerKey, ids, null, event)}
      >
        {items.map((resource) => (
          <ServiceCard
            key={resource.id}
            resource={resource}
            density={density}
            checking={checkingResourceId === resource.id}
            draggable={reorderEnabled}
            dragging={drag?.id === resource.id}
            onOpen={openResource}
            onInspect={(item) => setInspectedId(item.id)}
            onFavorite={(item) => void onPatchResource(item.id, { favorite: !item.favorite })}
            onRunCheck={(item) => void runCheck(item)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              setDrag({ id: resource.id, container: containerKey });
            }}
            onDragOver={(event) => {
              if (drag?.container === containerKey) event.preventDefault();
            }}
            onDrop={(event) => {
              event.stopPropagation();
              handleDrop(containerKey, ids, resource.id, event);
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </div>
    );
  }

  const dateLine = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="view-shell dashboard-view">
      <header className="dash-hero ops-hero">
        <div className="dash-hero-copy">
          <span className="ops-eyebrow">{greetingFor(now)}{username ? `, ${username}` : ""}</span>
          <h2>Lab operations</h2>
          <p>
            {dateLine}
            <span className="dash-hero-sep">·</span>
            {resources.length} service{resources.length === 1 ? "" : "s"}
            <span className="dash-hero-sep">·</span>
            {hostMonitors.length} host monitor{hostMonitors.length === 1 ? "" : "s"}
            <span className="dash-hero-pulse dot-online" /> {totals.online} online
            {totals.offline > 0 ? (
              <>
                <span className="dash-hero-pulse dot-offline" /> {totals.offline} offline
              </>
            ) : null}
            {totals.unknown > 0 ? (
              <>
                <span className="dash-hero-pulse dot-unknown" /> {totals.unknown} unknown
              </>
            ) : null}
          </p>
        </div>
        <div className="ops-status-panel">
          <div className="dash-clock" aria-hidden>{clock}</div>
          <span className={`ops-state ${dailyIssueCount > 0 ? "ops-state-attention" : "ops-state-ok"}`}>
            {dailyIssueCount > 0 ? `${dailyIssueCount} item${dailyIssueCount === 1 ? "" : "s"} need attention` : "All clear"}
          </span>
          <small>{lastUpdatedAt ? `Updated ${relativeTime(lastUpdatedAt)}` : "No samples yet"}</small>
        </div>
      </header>

      <section className="lab-vitals">
        <div className="section-heading compact-section-heading">
          <h3>Lab Vitals</h3>
          <button className="icon-text-button" type="button" onClick={onOpenSettings}>
            <Plus size={14} /> Host monitor
          </button>
        </div>
        {hostMonitors.length > 0 ? (
          <div className="host-grid">
            {hostMonitors.map((host) => (
              <HostVitalsCard key={host.id} host={host} onInspect={(item) => setInspectedHostId(item.id)} />
            ))}
          </div>
        ) : (
          <div className="metrics-empty-panel">
            <Server size={26} />
            <span>
              <strong>No host metrics yet</strong>
              <small>Add a Glances endpoint to show CPU, RAM, disk, network, containers, and 24h trends.</small>
            </span>
            <button className="primary-button" type="button" onClick={onOpenSettings}>
              <Plus size={15} /> Add Glances host
            </button>
          </div>
        )}
      </section>

      <section className="daily-briefing">
        <div className="section-heading compact-section-heading">
          <h3>Daily Briefing</h3>
          <span className="group-meta">last 24h</span>
        </div>
        <div className="briefing-summary-strip">
          <span><small>Services</small><strong>{briefing.summary.servicesOnline}/{briefing.summary.servicesTotal} online</strong></span>
          <span><small>Attention</small><strong>{dailyIssueCount}</strong></span>
          <span><small>Hosts</small><strong>{briefing.summary.hostsOffline} offline · {briefing.summary.hostsUnderPressure} pressure</strong></span>
          <span><small>Watchlist</small><strong>{briefing.summary.pendingFailures} failing · {briefing.summary.pendingRecoveries} recovering</strong></span>
        </div>
        <div className="briefing-grid">
          <article className={`briefing-card ${briefing.offlineServices.length > 0 ? "briefing-danger" : ""}`}>
            <strong><AlertTriangle size={15} /> Offline services</strong>
            {briefing.offlineServices.length > 0 ? (
              briefing.offlineServices.map((item) => {
                const resource = resourceById(item.id);
                return (
                  <div className="briefing-action-row" key={item.id}>
                    <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.id)}>
                      <span>{item.name}</span>
                      <small>{item.error ?? "offline"}</small>
                    </button>
                    {resource?.monitoringMode === "auto" ? (
                      <button className="svc-action" type="button" title="Run check" onClick={() => runResourceById(item.id)}>
                        <RefreshCw size={13} />
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : <p>No services are down.</p>}
          </article>

          <article className={briefing.hostsUnderPressure.length > 0 ? "briefing-card briefing-warning" : "briefing-card"}>
            <strong><Cpu size={15} /> Host pressure</strong>
            {briefing.hostsUnderPressure.length > 0 ? (
              briefing.hostsUnderPressure.map((item) => (
                <span key={`${item.id}-${item.metric}`}>
                  <i>{item.name}</i>
                  <small>{item.metric} {formatPercent(item.value)}</small>
                </span>
              ))
            ) : <p>CPU, RAM, and disk pressure look normal.</p>}
          </article>

          <article className="briefing-card">
            <strong><Activity size={15} /> 24h timeline</strong>
            {briefing.recentChanges.length > 0 ? (
              briefing.recentChanges.map((item) => (
                <button key={`${item.resourceId}-${item.changedAt}`} type="button" onClick={() => inspectResource(item.resourceId)}>
                  <span>{item.name}</span>
                  <small>{item.status} · {relativeTime(item.changedAt)}</small>
                </button>
              ))
            ) : <p>No status transitions in the last day.</p>}
          </article>

          <article className={briefing.watchlist.length > 0 ? "briefing-card briefing-warning" : "briefing-card"}>
            <strong><RefreshCw size={15} /> Threshold watchlist</strong>
            {briefing.watchlist.length > 0 ? (
              briefing.watchlist.map((item) => (
                <div className="briefing-action-row" key={item.checkId}>
                  <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.resourceId)}>
                    <span>{item.resourceName}</span>
                    <small>
                      {item.direction === "failing" ? "failing" : "recovering"} · {item.consecutive}/{item.threshold}
                    </small>
                  </button>
                  <button className="svc-action" type="button" title="Run check" onClick={() => runResourceById(item.resourceId)}>
                    <RefreshCw size={13} />
                  </button>
                </div>
              ))
            ) : <p>No checks are waiting on thresholds.</p>}
          </article>

          <article className={briefing.staleChecks.length + briefing.unmonitoredServices.length > 0 ? "briefing-card briefing-warning" : "briefing-card"}>
            <strong><RefreshCw size={15} /> Monitoring gaps</strong>
            {briefing.staleChecks.slice(0, 4).map((item) => (
              <div className="briefing-action-row" key={item.checkId}>
                <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.resourceId)}>
                  <span>{item.resourceName}</span>
                  <small>stale · {item.lastCheckedAt ? relativeTime(item.lastCheckedAt) : "never"}</small>
                </button>
                <button className="svc-action" type="button" title="Run check" onClick={() => runResourceById(item.resourceId)}>
                  <RefreshCw size={13} />
                </button>
              </div>
            ))}
            {briefing.unmonitoredServices.slice(0, 4).map((item) => (
              <div className="briefing-action-row" key={item.id}>
                <button className="briefing-main-action" type="button" onClick={() => inspectResource(item.id)}>
                  <span>{item.name}</span>
                  <small>no active checks</small>
                </button>
                <button className="svc-action" type="button" title="Edit service" onClick={() => editResource(item.id)}>
                  <Info size={13} />
                </button>
              </div>
            ))}
            {briefing.staleChecks.length === 0 && briefing.unmonitoredServices.length === 0 ? <p>All automatic services have fresh checks.</p> : null}
          </article>
        </div>
      </section>

      <div className="dash-toolbar">
        <label className="search-box service-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" />
          <kbd>⌘K</kbd>
        </label>

        <div className="filter-chips" aria-label="Service filters">
          {filters.map((filter) => (
            <button
              key={filter.id}
              className={statusFilter === filter.id ? "active" : ""}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
            >
              {filter.label}
              <i>{filter.count}</i>
            </button>
          ))}
        </div>

        <div className="dash-toolbar-end">
          <div className="segmented-control density-toggle" role="group" aria-label="Layout density">
            <button
              className={density === "grid" ? "active" : ""}
              type="button"
              title="Grid view"
              onClick={() => setDensity("grid")}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              className={density === "list" ? "active" : ""}
              type="button"
              title="List view"
              onClick={() => setDensity("list")}
            >
              <Rows3 size={15} />
            </button>
          </div>
          <button className="icon-button" type="button" title="Refresh" onClick={() => void onRefresh()}>
            <RefreshCw size={16} />
          </button>
          <button className="primary-button header-primary-action" type="button" onClick={onOpenServices}>
            <Plus size={16} /> Add service
          </button>
        </div>
      </div>

      {checkError ? <div className="app-error">{checkError}</div> : null}

      {offlineResources.length > 0 && statusFilter === "all" && !query ? (
        <section className="attention-strip" aria-label="Services needing attention">
          <span className="attention-label">
            <AlertTriangle size={15} />
            {offlineResources.length} service{offlineResources.length === 1 ? "" : "s"} down
          </span>
          <div className="attention-chips">
            {offlineResources.map((resource) => (
              <button
                key={resource.id}
                type="button"
                title={latestErrors(resource)[0] ?? "Offline"}
                onClick={() => setInspectedId(resource.id)}
              >
                {resource.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {favorites.length > 0 && statusFilter === "all" && !query ? (
        <section className="favorites-strip" aria-label="Favorites">
          {favorites.map((resource) => {
            const status = statusFor(resource);
            return (
              <button
                key={resource.id}
                className="favorite-tile"
                type="button"
                title={resource.url ? `Open ${resource.name}` : resource.name}
                onClick={() => (resource.url ? openResource(resource) : setInspectedId(resource.id))}
              >
                <ServiceIcon resource={resource} size={30} />
                <span>{resource.name}</span>
                <i className={`svc-dot dot-${status}`} />
              </button>
            );
          })}
        </section>
      ) : null}

      {resources.length === 0 ? (
        <EmptyPanel
          icon={<Server size={36} />}
          title="No services yet"
          body="Add Plex, Home Assistant, NAS, router, websites, and anything else you host."
          action={
            <button className="icon-text-button" type="button" onClick={onOpenServices}>
              <Plus size={16} /> Add service
            </button>
          }
        />
      ) : null}

      {filteredGroups.map((group) => {
        const groupTotals = summarizeResourceStatus(group.resources);
        return (
          <section className="service-group" key={group.id}>
            <div className="service-group-header">
              <button
                className="group-toggle"
                type="button"
                onClick={() => onPatchGroup(group.id, { collapsed: !group.collapsed })}
              >
                {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <h3>{group.name}</h3>
              </button>
              <span className="group-meta">
                {groupTotals.online}/{group.resources.length} online
              </span>
            </div>
            {!group.collapsed ? renderCards(group.id, group.resources) : null}
          </section>
        );
      })}

      {filteredUngrouped.length > 0 ? (
        <section className="service-group">
          <div className="service-group-header">
            <h3>Ungrouped</h3>
            <span className="group-meta">
              {summarizeResourceStatus(filteredUngrouped).online}/{filteredUngrouped.length} online
            </span>
          </div>
          {renderCards("ungrouped", filteredUngrouped)}
        </section>
      ) : null}

      {resources.length > 0 && visibleCount === 0 ? (
        <EmptyPanel icon={<Search size={36} />} title="No services match" body="Clear search or change the status filter." />
      ) : null}

      {inspected ? (
        <ServiceDrawer
          resource={inspected}
          checking={checkingResourceId === inspected.id}
          onClose={() => setInspectedId(null)}
          onOpen={openResource}
          onFavorite={(item) => void onPatchResource(item.id, { favorite: !item.favorite })}
          onRunCheck={(item) => void runCheck(item)}
          onEdit={(item) => {
            setInspectedId(null);
            onEditService(item);
          }}
        />
      ) : null}

      {inspectedHost ? (
        <HostDetailDrawer
          host={inspectedHost}
          loading={hostDetailLoading}
          error={hostDetailError}
          onClose={() => setInspectedHostId(null)}
        />
      ) : null}
    </main>
  );
}
