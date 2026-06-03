import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe2,
  Info,
  KeyRound,
  Laptop,
  Monitor,
  Plus,
  Search,
  Server,
  Star,
  TerminalSquare,
  Wifi,
  WifiOff
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { ConnectionDto } from "../../lib/api";
import type { DashboardResource } from "../../../shared/types";
import { WidgetSettings } from "../../components/WidgetSettings";
import { EmptyPanel, MetricCard, StatusBadge } from "../../components/Primitives";
import { dashboardResources, formatDateTime, statusFor, summarizeResourceStatus } from "../../lib/format";
import type { V2Data } from "../types";

const icons: Record<string, ReactNode> = {
  app: <Boxes size={20} />,
  website: <Globe2 size={20} />,
  docker: <Boxes size={20} />,
  vm: <Laptop size={20} />,
  server: <Server size={20} />,
  other: <Monitor size={20} />
};

function ResourceTile({
  resource,
  connection,
  onOpen,
  onFavorite,
  onInspect,
  onConnect
}: {
  resource: DashboardResource;
  connection: ConnectionDto | null;
  onOpen: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => void;
  onInspect: (resource: DashboardResource) => void;
  onConnect: (connection: ConnectionDto) => void;
}) {
  const status = statusFor(resource);
  const color = resource.color ?? "#2dd4bf";
  const checks = resource.healthChecks ?? [];
  const connections = resource.connections ?? [];
  const latestCheck = checks
    .filter((check) => check.latestCheckedAt)
    .sort((left, right) => String(right.latestCheckedAt).localeCompare(String(left.latestCheckedAt)))[0];

  return (
    <article className={`resource-tile tile-${status}`}>
      <div className="resource-heading">
        <span className="resource-icon" style={{ color }}>
          {icons[resource.kind] ?? icons.other}
        </span>
        <div>
          <h3>{resource.name}</h3>
          <p>{resource.url ?? resource.host ?? resource.kind}</p>
        </div>
      </div>
      <div className="resource-meta">
        <span className="kind-chip">{resource.kind}</span>
        {resource.host ? <span>{resource.host}</span> : null}
        {connections.length > 0 ? (
          <span>{connections.map((item) => item.type.toUpperCase()).join(" + ")}</span>
        ) : null}
        {resource.tags?.length ? <span>{resource.tags.map((tag) => tag.name).join(", ")}</span> : null}
      </div>
      {resource.description ? <p className="resource-description">{resource.description}</p> : null}
      <div className="resource-health-line">
        <span>{checks.length} checks</span>
        <span>{formatDateTime(latestCheck?.latestCheckedAt)}</span>
      </div>
      <div className="resource-actions">
        <StatusBadge status={status} />
        {connection ? (
          <button className="icon-button is-active" type="button" title={`Connect ${connection.type.toUpperCase()}`} onClick={() => onConnect(connection)}>
            <TerminalSquare size={16} />
          </button>
        ) : null}
        <button className="icon-button" type="button" title="Details" onClick={() => onInspect(resource)}>
          <Info size={16} />
        </button>
        <button
          className={`icon-button ${resource.favorite ? "is-active" : ""}`}
          type="button"
          title="Favorite"
          onClick={() => onFavorite(resource)}
        >
          <Star size={16} />
        </button>
        <button className="icon-button" type="button" title="Open" disabled={!resource.url} onClick={() => onOpen(resource)}>
          <ExternalLink size={16} />
        </button>
      </div>
    </article>
  );
}

function WidgetCard({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`widget-card ${wide ? "widget-wide" : ""}`}>
      <div className="widget-header">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function DashboardConsole({
  data,
  onRefresh,
  onPatchResource,
  onPatchGroup,
  onOpenInventory,
  onInspectResource,
  onOpenIncident,
  onConnect
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  onPatchResource: (id: string, body: Record<string, unknown>) => Promise<void>;
  onPatchGroup: (id: string, body: Record<string, unknown>) => Promise<void>;
  onOpenInventory: () => void;
  onInspectResource: (resource: DashboardResource) => void;
  onOpenIncident: (id: string) => void;
  onConnect: (connection: ConnectionDto) => void;
}) {
  const [query, setQuery] = useState("");
  const resources = useMemo(
    () => dashboardResources(data.dashboard.groups, data.dashboard.ungroupedResources),
    [data.dashboard]
  );
  const connectionByResource = useMemo(() => {
    const map = new Map<string, ConnectionDto>();
    for (const connection of data.connections) {
      if (!map.has(connection.resourceId)) {
        map.set(connection.resourceId, connection);
      }
    }
    return map;
  }, [data.connections]);
  const enabledWidgets = useMemo(
    () => new Set(data.widgets.filter((widget) => widget.enabled).map((widget) => widget.type)),
    [data.widgets]
  );
  const totals = summarizeResourceStatus(resources);
  const favoriteResources = resources.filter((resource) => resource.favorite).slice(0, 6);
  const failingChecks = data.checks.filter((check) => check.latestStatus === "offline").slice(0, 8);
  const openIncidents = data.incidents.filter((incident) => incident.status !== "resolved").slice(0, 8);
  const filteredGroups = data.dashboard.groups
    .map((group) => ({
      ...group,
      resources: group.resources.filter((resource) => {
        const haystack = `${resource.name} ${resource.url ?? ""} ${resource.host ?? ""} ${resource.kind}`;
        return haystack.toLowerCase().includes(query.toLowerCase());
      })
    }))
    .filter((group) => group.resources.length > 0 || query.length === 0);
  const filteredUngrouped = data.dashboard.ungroupedResources.filter((resource) => {
    const haystack = `${resource.name} ${resource.url ?? ""} ${resource.host ?? ""} ${resource.kind}`;
    return haystack.toLowerCase().includes(query.toLowerCase());
  });

  function openResource(resource: DashboardResource) {
    if (resource.url) {
      window.open(resource.url, "_blank", "noopener,noreferrer");
    }
  }

  function renderResourceTile(resource: DashboardResource) {
    return (
      <ResourceTile
        key={resource.id}
        resource={resource}
        connection={connectionByResource.get(resource.id) ?? null}
        onInspect={onInspectResource}
        onOpen={openResource}
        onConnect={onConnect}
        onFavorite={(item) => onPatchResource(item.id, { favorite: !item.favorite })}
      />
    );
  }

  return (
    <main className="view-shell pro-dashboard">
      <header className="view-header">
        <div>
          <h2>Pro Console</h2>
          <span>{resources.length} resources · {data.incidents.length} incidents · {data.sessionHistory.length} sessions</span>
        </div>
        <div className="header-actions">
          <label className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter resources" />
          </label>
          <button className="icon-text-button" type="button" onClick={onRefresh}>
            <Activity size={16} />
            Refresh
          </button>
          <button className="icon-text-button" type="button" onClick={onOpenInventory}>
            <Plus size={16} />
            Add
          </button>
        </div>
      </header>

      <WidgetSettings widgets={data.widgets} onRefresh={onRefresh} />

      <section className="dashboard-overview">
        <MetricCard icon={<Wifi size={18} />} label="Online" value={totals.online} tone="online" />
        <MetricCard icon={<WifiOff size={18} />} label="Offline" value={totals.offline} tone="offline" />
        <MetricCard icon={<Activity size={18} />} label="Unknown" value={totals.unknown} />
        <MetricCard icon={<TerminalSquare size={18} />} label="Connections" value={totals.connections} tone="accent" />
        <MetricCard icon={<KeyRound size={18} />} label="Vault Items" value={data.credentials.length} />
      </section>

      <section className="widget-grid">
        {enabledWidgets.has("incidents") ? (
          <WidgetCard title="Incidents">
            <div className="compact-list">
              {openIncidents.map((incident) => (
                <button className="compact-row" key={incident.id} type="button" onClick={() => onOpenIncident(incident.id)}>
                  <span className={`severity-dot severity-${incident.severity}`} />
                  <span>
                    <strong>{incident.title}</strong>
                    <small>{incident.status} · {formatDateTime(incident.openedAt)}</small>
                  </span>
                </button>
              ))}
              {openIncidents.length === 0 ? <p className="muted-copy">No active incidents.</p> : null}
            </div>
          </WidgetCard>
        ) : null}

        {enabledWidgets.has("failingChecks") ? (
          <WidgetCard title="Failing Checks">
            <div className="compact-list">
              {failingChecks.map((check) => (
                <div className="compact-row" key={check.id}>
                  <Activity size={16} />
                  <span>
                    <strong>{check.resource?.name ?? check.target}</strong>
                    <small>{check.latestError ?? check.target}</small>
                  </span>
                </div>
              ))}
              {failingChecks.length === 0 ? <p className="muted-copy">No failing checks.</p> : null}
            </div>
          </WidgetCard>
        ) : null}

        {enabledWidgets.has("recentSessions") ? (
          <WidgetCard title="Recent Sessions">
            <div className="compact-list">
              {data.sessionHistory.slice(0, 6).map((session) => (
                <div className="compact-row" key={session.id}>
                  <TerminalSquare size={16} />
                  <span>
                    <strong>{session.resourceName}</strong>
                    <small>{session.protocol.toUpperCase()} · {session.status} · {formatDateTime(session.startedAt)}</small>
                  </span>
                </div>
              ))}
              {data.sessionHistory.length === 0 ? <p className="muted-copy">No remote sessions yet.</p> : null}
            </div>
          </WidgetCard>
        ) : null}

        {enabledWidgets.has("notes") ? (
          <WidgetCard title="Pinned Notes">
            <div className="compact-list">
              {data.notes.filter((note) => note.pinned).slice(0, 4).map((note) => (
                <div className="compact-row" key={note.id}>
                  <Clock3 size={16} />
                  <span>
                    <strong>{note.title}</strong>
                    <small>{note.body}</small>
                  </span>
                </div>
              ))}
              {data.notes.filter((note) => note.pinned).length === 0 ? <p className="muted-copy">No pinned notes.</p> : null}
            </div>
          </WidgetCard>
        ) : null}
      </section>

      {resources.length === 0 ? (
        <EmptyPanel
          icon={<Server size={36} />}
          title="No services yet"
          body="Add your first app, VM, server, or website, then attach checks and remote access."
          action={
            <button className="icon-text-button" type="button" onClick={onOpenInventory}>
              <Plus size={16} />
              Add resource
            </button>
          }
        />
      ) : null}

      {enabledWidgets.has("favorites") && favoriteResources.length > 0 ? (
        <section className="resource-section">
          <div className="section-heading">
            <h3>Favorites</h3>
            <span>{favoriteResources.length}</span>
          </div>
          <div className="tile-grid">{favoriteResources.map(renderResourceTile)}</div>
        </section>
      ) : null}

      {filteredGroups.map((group) => (
        <section className="resource-section" key={group.id}>
          <div className="section-heading group-heading">
            <button className="group-toggle" type="button" onClick={() => onPatchGroup(group.id, { collapsed: !group.collapsed })}>
              {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              <h3>{group.name}</h3>
            </button>
            <span>{group.resources.length}</span>
          </div>
          {!group.collapsed ? <div className="tile-grid">{group.resources.map(renderResourceTile)}</div> : null}
        </section>
      ))}

      {filteredUngrouped.length > 0 ? (
        <section className="resource-section">
          <div className="section-heading">
            <h3>Ungrouped</h3>
            <span>{filteredUngrouped.length}</span>
          </div>
          <div className="tile-grid">{filteredUngrouped.map(renderResourceTile)}</div>
        </section>
      ) : null}
    </main>
  );
}
