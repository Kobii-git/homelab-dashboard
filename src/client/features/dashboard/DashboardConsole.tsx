import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe2,
  Laptop,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server,
  Star,
  Wifi,
  WifiOff
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { DashboardResource } from "../../../shared/types";
import { EmptyPanel, MetricCard, PageHeader, StatusBadge } from "../../components/Primitives";
import { dashboardResources, formatDateTime, statusFor, summarizeResourceStatus } from "../../lib/format";
import { type AppData } from "../types";

type StatusFilter = "all" | "favorites" | "online" | "offline" | "unknown";

const icons: Record<string, ReactNode> = {
  app: <Server size={22} />,
  website: <Globe2 size={22} />,
  docker: <Monitor size={22} />,
  vm: <Laptop size={22} />,
  server: <Server size={22} />,
  other: <Server size={22} />
};

const filters: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "online", label: "Online" },
  { id: "offline", label: "Offline" },
  { id: "unknown", label: "Unknown" }
];

function serviceAddress(resource: DashboardResource): string {
  if (resource.url) {
    try {
      const parsed = new URL(resource.url);
      return parsed.host;
    } catch {
      return resource.url;
    }
  }
  return resource.host ?? resource.kind;
}

function latestLatency(resource: DashboardResource): number | null {
  const latencies = (resource.healthChecks ?? [])
    .map((check) => check.latestLatencyMs)
    .filter((value): value is number => typeof value === "number");
  if (latencies.length === 0) return null;
  return Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
}

function latestCheckTime(resource: DashboardResource): string | null {
  return (resource.healthChecks ?? [])
    .map((check) => check.latestCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function formatLatency(value: number | null): string {
  return value == null ? "No latency" : `${value} ms`;
}

function monitoringLabel(resource: DashboardResource): string {
  if (resource.monitoringMode === "disabled") {
    return "Monitoring off";
  }

  if (resource.monitoringMode === "manual") {
    return "Manual";
  }

  return formatLatency(latestLatency(resource));
}

function HealthMixBar({ online, offline, unknown }: { online: number; offline: number; unknown: number }) {
  const total = Math.max(1, online + offline + unknown);
  return (
    <div className="health-mix-bar" aria-label="Service health mix">
      <span className="health-mix-online" style={{ width: `${(online / total) * 100}%` }} />
      <span className="health-mix-offline" style={{ width: `${(offline / total) * 100}%` }} />
      <span className="health-mix-unknown" style={{ width: `${(unknown / total) * 100}%` }} />
    </div>
  );
}

function LatencyPanel({ resources }: { resources: DashboardResource[] }) {
  const latencyRows = resources
    .map((resource) => ({ resource, latency: latestLatency(resource) }))
    .filter((row): row is { resource: DashboardResource; latency: number } => row.latency != null)
    .sort((left, right) => right.latency - left.latency)
    .slice(0, 6);
  const maxLatency = Math.max(1, ...latencyRows.map((row) => row.latency));

  return (
    <section className="dashboard-signal-panel">
      <div className="signal-panel-header">
        <span><BarChart3 size={16} /> Slowest responses</span>
        <small>{latencyRows.length ? "latest check" : "waiting for checks"}</small>
      </div>
      <div className="latency-bars">
        {latencyRows.map(({ resource, latency }) => (
          <div className="latency-row" key={resource.id}>
            <span>{resource.name}</span>
            <div className="latency-track">
              <span style={{ width: `${Math.max(8, (latency / maxLatency) * 100)}%` }} />
            </div>
            <strong>{latency} ms</strong>
          </div>
        ))}
        {latencyRows.length === 0 ? <p className="muted-copy">Add health checks to see response-time signals.</p> : null}
      </div>
    </section>
  );
}

function ServiceCard({
  resource,
  onOpen,
  onFavorite,
  onRunCheck,
  checking
}: {
  resource: DashboardResource;
  onOpen: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => void;
  onRunCheck: (resource: DashboardResource) => void;
  checking: boolean;
}) {
  const status = statusFor(resource);
  const color = resource.color ?? "#2dd4bf";
  const address = serviceAddress(resource);
  const checkedAt = latestCheckTime(resource);
  const hasChecks = (resource.healthChecks ?? []).length > 0;
  const automatic = resource.monitoringMode === "auto";

  return (
    <article className={`service-card service-${status} ${resource.url ? "can-launch" : ""}`}>
      <button
        className="service-card-main"
        type="button"
        disabled={!resource.url}
        onClick={() => onOpen(resource)}
        title={resource.url ? `Open ${resource.name}` : "Add a URL or host to launch this service"}
      >
        <span className="service-icon" style={{ color }}>
          {resource.icon ? resource.icon.slice(0, 2).toUpperCase() : icons[resource.kind] ?? icons.other}
        </span>
        <span className="service-copy">
          <strong>{resource.name}</strong>
          <small>{address}</small>
        </span>
      </button>

      <div className="service-card-meta">
        <button
          className="status-action"
          type="button"
          onClick={() => onRunCheck(resource)}
          title={automatic
            ? hasChecks ? `Run health check for ${resource.name}` : `Create and run a default health check for ${resource.name}`
            : `${resource.name} is set to ${resource.monitoringMode} monitoring`}
          disabled={!automatic || checking || (!resource.url && !resource.host)}
        >
          {checking ? <RefreshCw className="spin" size={14} /> : <StatusBadge status={status} />}
        </button>
        <button
          className="latency-action"
          type="button"
          onClick={() => onRunCheck(resource)}
          title={automatic
            ? hasChecks ? `Run health check for ${resource.name}` : `Create and run a default health check for ${resource.name}`
            : `${resource.name} is set to ${resource.monitoringMode} monitoring`}
          disabled={!automatic || checking || (!resource.url && !resource.host)}
        >
          {checking ? "Checking..." : monitoringLabel(resource)}
        </button>
        <span>{formatDateTime(checkedAt)}</span>
      </div>

      <div className="service-card-actions">
        <span className="kind-chip">{resource.kind}</span>
        <button
          className={`icon-button ${resource.favorite ? "is-active" : ""}`}
          type="button"
          title={resource.favorite ? "Remove favorite" : "Favorite"}
          onClick={() => onFavorite(resource)}
          aria-pressed={resource.favorite}
        >
          <Star size={15} fill={resource.favorite ? "currentColor" : "none"} />
        </button>
        <button className="icon-button" type="button" title="Open service" disabled={!resource.url} onClick={() => onOpen(resource)}>
          <ExternalLink size={15} />
        </button>
      </div>
    </article>
  );
}

export function DashboardConsole({
  data,
  onRefresh,
  onPatchResource,
  onRunCheck,
  onPatchGroup,
  onOpenServices
}: {
  data: AppData;
  onRefresh: () => Promise<void>;
  onPatchResource: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRunCheck: (resource: DashboardResource) => Promise<void>;
  onPatchGroup: (id: string, body: Record<string, unknown>) => Promise<void>;
  onOpenServices: () => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [checkingResourceId, setCheckingResourceId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const resources = useMemo(
    () => dashboardResources(data.dashboard.groups, data.dashboard.ungroupedResources),
    [data.dashboard]
  );
  const totals = summarizeResourceStatus(resources);
  const launchableCount = resources.filter((resource) => resource.url).length;

  function matchesResource(resource: DashboardResource): boolean {
    const status = statusFor(resource);
    const haystack = [
      resource.name,
      resource.url,
      resource.host,
      resource.kind,
      resource.description
    ].join(" ").toLowerCase();
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
  const visibleCount = filteredGroups.reduce((sum, group) => sum + group.resources.length, 0) + filteredUngrouped.length;

  function renderResourceCard(resource: DashboardResource) {
    return (
      <ServiceCard
        key={resource.id}
        resource={resource}
        onOpen={(service) => {
          if (service.url) {
            window.open(service.url, "_blank", "noopener,noreferrer");
          }
        }}
        onFavorite={(item) => void onPatchResource(item.id, { favorite: !item.favorite })}
        onRunCheck={async (item) => {
          setCheckingResourceId(item.id);
          setCheckError(null);
          try {
            await onRunCheck(item);
          } catch (error) {
            setCheckError(error instanceof Error ? error.message : "Health check failed");
          } finally {
            setCheckingResourceId(null);
          }
        }}
        checking={checkingResourceId === resource.id}
      />
    );
  }

  return (
    <main className="view-shell service-dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="Launch hosted services and monitor health in one place"
        actions={
          <>
            <label className="search-box service-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" />
            </label>
            <button className="icon-text-button" type="button" onClick={onRefresh}>
              <RefreshCw size={16} />
              Refresh
            </button>
            <button className="primary-button header-primary-action" type="button" onClick={onOpenServices}>
              <Plus size={16} />
              Add service
            </button>
          </>
        }
      />

      <section className="dashboard-overview dashboard-compact-metrics">
        <MetricCard icon={<Server size={18} />} label="Services" value={resources.length} tone="accent" />
        <MetricCard icon={<ExternalLink size={18} />} label="Launchable" value={launchableCount} />
        <MetricCard icon={<Wifi size={18} />} label="Online" value={totals.online} tone="online" />
        <MetricCard icon={<WifiOff size={18} />} label="Offline" value={totals.offline} tone="offline" />
      </section>

      {checkError ? <div className="app-error">{checkError}</div> : null}

      <section className="dashboard-signal-grid">
        <section className="dashboard-signal-panel">
          <div className="signal-panel-header">
            <span><Activity size={16} /> Health mix</span>
            <small>{totals.checks} checks</small>
          </div>
          <HealthMixBar online={totals.online} offline={totals.offline} unknown={totals.unknown} />
          <div className="signal-legend">
            <span><i className="legend-online" /> {totals.online} online</span>
            <span><i className="legend-offline" /> {totals.offline} offline</span>
            <span><i className="legend-unknown" /> {totals.unknown} unknown</span>
          </div>
        </section>

        <LatencyPanel resources={resources} />
      </section>

      <section className="service-filter-strip">
        <div className="service-filter-tabs" aria-label="Service filters">
          {filters.map((filter) => (
            <button
              key={filter.id}
              className={statusFilter === filter.id ? "active" : ""}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <span>{visibleCount} shown</span>
      </section>

      {resources.length === 0 ? (
        <EmptyPanel
          icon={<Server size={36} />}
          title="No services yet"
          body="Add Plex, Home Assistant, NAS, router, websites, and anything else you host."
          action={
            <button className="icon-text-button" type="button" onClick={onOpenServices}>
              <Plus size={16} />
              Add service
            </button>
          }
        />
      ) : null}

      {filteredGroups.map((group) => (
        <section className="service-group" key={group.id}>
          <div className="service-group-header">
            <button className="group-toggle" type="button" onClick={() => onPatchGroup(group.id, { collapsed: !group.collapsed })}>
              {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              <h3>{group.name}</h3>
            </button>
            <span>{group.resources.length}</span>
          </div>
          {!group.collapsed ? <div className="service-grid">{group.resources.map(renderResourceCard)}</div> : null}
        </section>
      ))}

      {filteredUngrouped.length > 0 ? (
        <section className="service-group">
          <div className="service-group-header">
            <h3>Ungrouped</h3>
            <span>{filteredUngrouped.length}</span>
          </div>
          <div className="service-grid">{filteredUngrouped.map(renderResourceCard)}</div>
        </section>
      ) : null}

      {resources.length > 0 && visibleCount === 0 ? (
        <EmptyPanel icon={<Search size={36} />} title="No services match" body="Clear search or change the status filter." />
      ) : null}
    </main>
  );
}
