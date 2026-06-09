import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe2,
  Info,
  Laptop,
  Monitor,
  Plus,
  Search,
  Server,
  Star,
  Wifi,
  WifiOff
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import type { DashboardWidgetDto } from "../../lib/api";
import type { DashboardResource } from "../../../shared/types";
import { WidgetSettings } from "../../components/WidgetSettings";
import { EmptyPanel, MetricCard, PageHeader, StatusBadge } from "../../components/Primitives";
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
  onOpen,
  onFavorite,
  onInspect
}: {
  resource: DashboardResource;
  onOpen: (resource: DashboardResource) => void;
  onFavorite: (resource: DashboardResource) => void;
  onInspect: (resource: DashboardResource) => void;
}) {
  const status = statusFor(resource);
  const color = resource.color ?? "#2dd4bf";
  const checks = resource.healthChecks ?? [];
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
        {resource.tags?.length ? <span>{resource.tags.map((tag) => tag.name).join(", ")}</span> : null}
      </div>
      {resource.description ? <p className="resource-description">{resource.description}</p> : null}
      <div className="resource-health-line">
        <span>{checks.length} checks</span>
        <span>{formatDateTime(latestCheck?.latestCheckedAt)}</span>
      </div>
      <div className="resource-actions">
        <StatusBadge status={status} />
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

function widgetSpanStyle(widget: DashboardWidgetDto): CSSProperties {
  const span = Math.min(12, Math.max(3, widget.w || 4));
  return { "--widget-span": String(span) } as CSSProperties;
}

function orderedUniqueWidgets(widgets: DashboardWidgetDto[]) {
  const seen = new Set<string>();
  return [...widgets]
    .filter((widget) => widget.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title))
    .filter((widget) => {
      if (seen.has(widget.type)) {
        return false;
      }
      seen.add(widget.type);
      return true;
    });
}

function WidgetCard({ title, children, widget }: { title: string; children: ReactNode; widget: DashboardWidgetDto }) {
  return (
    <section className="widget-card" style={widgetSpanStyle(widget)}>
      <div className="widget-header">
        <h3>{title}</h3>
      </div>
      <div className="widget-body">{children}</div>
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
  onOpenIncident
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  onPatchResource: (id: string, body: Record<string, unknown>) => Promise<void>;
  onPatchGroup: (id: string, body: Record<string, unknown>) => Promise<void>;
  onOpenInventory: () => void;
  onInspectResource: (resource: DashboardResource) => void;
  onOpenIncident: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const resources = useMemo(
    () => dashboardResources(data.dashboard.groups, data.dashboard.ungroupedResources),
    [data.dashboard]
  );
  const orderedWidgets = useMemo(
    () => orderedUniqueWidgets(data.widgets),
    [data.widgets]
  );
  const totals = summarizeResourceStatus(resources);
  const favoriteResources = resources.filter((resource) => resource.favorite).slice(0, 6);
  const failingChecks = data.checks.filter((check) => check.latestStatus === "offline").slice(0, 8);
  const openIncidents = data.incidents.filter((incident) => incident.status !== "resolved").slice(0, 8);
  const pinnedNotes = data.notes.filter((note) => note.pinned).slice(0, 4);
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
        onInspect={onInspectResource}
        onOpen={openResource}
        onFavorite={(item) => onPatchResource(item.id, { favorite: !item.favorite })}
      />
    );
  }

  function renderDashboardWidget(widget: DashboardWidgetDto) {
    switch (widget.type) {
      case "serviceStatus":
        return (
          <WidgetCard key={widget.id} title={widget.title} widget={widget}>
            <div className="dashboard-overview widget-metrics">
              <MetricCard icon={<Wifi size={18} />} label="Online" value={totals.online} tone="online" />
              <MetricCard icon={<WifiOff size={18} />} label="Offline" value={totals.offline} tone="offline" />
              <MetricCard icon={<Activity size={18} />} label="Unknown" value={totals.unknown} />
              <MetricCard icon={<Server size={18} />} label="Total Services" value={resources.length} tone="accent" />
            </div>
          </WidgetCard>
        );
      case "incidents":
        return (
          <WidgetCard key={widget.id} title={widget.title} widget={widget}>
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
              {openIncidents.length === 0 ? (
                <EmptyPanel compact icon={<Activity size={18} />} title="No active incidents" body="Open incidents will appear here." />
              ) : null}
            </div>
          </WidgetCard>
        );
      case "favorites":
        return (
          <WidgetCard key={widget.id} title={widget.title} widget={widget}>
            <div className="compact-list">
              {favoriteResources.map((resource) => (
                <button
                  className="compact-row"
                  key={resource.id}
                  type="button"
                  onClick={() => (resource.url ? openResource(resource) : onInspectResource(resource))}
                >
                  <span className="resource-icon" style={{ color: resource.color ?? "#2dd4bf" }}>
                    {icons[resource.kind] ?? icons.other}
                  </span>
                  <span>
                    <strong>{resource.name}</strong>
                    <small>{resource.url ?? resource.host ?? resource.kind}</small>
                  </span>
                  <StatusBadge status={statusFor(resource)} />
                </button>
              ))}
              {favoriteResources.length === 0 ? (
                <EmptyPanel compact icon={<Star size={18} />} title="No favorites" body="Mark resources as favorites to pin them here." />
              ) : null}
            </div>
          </WidgetCard>
        );
      case "failingChecks":
        return (
          <WidgetCard key={widget.id} title={widget.title} widget={widget}>
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
              {failingChecks.length === 0 ? (
                <EmptyPanel compact icon={<Activity size={18} />} title="All checks passing" body="No failing checks right now." />
              ) : null}
            </div>
          </WidgetCard>
        );
      case "notes":
        return (
          <WidgetCard key={widget.id} title={widget.title} widget={widget}>
            <div className="compact-list">
              {pinnedNotes.map((note) => (
                <div className="compact-row" key={note.id}>
                  <Clock3 size={16} />
                  <span>
                    <strong>{note.title}</strong>
                    <small>{note.body}</small>
                  </span>
                </div>
              ))}
              {pinnedNotes.length === 0 ? (
                <EmptyPanel compact icon={<Clock3 size={18} />} title="No pinned notes" body="Pin notes from Inventory to surface them here." />
              ) : null}
            </div>
          </WidgetCard>
        );
      default:
        return null;
    }
  }

  return (
    <main className="view-shell pro-dashboard">
      <PageHeader
        title="Dashboard"
        subtitle={`${resources.length} resources · ${data.incidents.length} incidents`}
        actions={
          <>
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
          </>
        }
      />

      <WidgetSettings widgets={data.widgets} onRefresh={onRefresh} />

      <section className="widget-grid">
        {orderedWidgets.map(renderDashboardWidget)}
      </section>

      {resources.length === 0 ? (
        <EmptyPanel
          icon={<Server size={36} />}
          title="No services yet"
          body="Add your first app, VM, server, or website, then attach checks."
          action={
            <button className="icon-text-button" type="button" onClick={onOpenInventory}>
              <Plus size={16} />
              Add resource
            </button>
          }
        />
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
