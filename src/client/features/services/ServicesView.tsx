import { Activity, ChevronDown, ChevronUp, Copy, Plus, Pencil, Save, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { HEALTH_CHECK_TYPES, HEALTH_STATUSES, MONITORING_MODES, RESOURCE_KINDS } from "../../../shared/types";
import { MetricCard, PageHeader, StatusBadge } from "../../components/Primitives";
import { ServiceIcon } from "../../components/ServiceIcon";
import { FormErrorBanner, runFormAction, runFormSubmit } from "../../lib/forms";
import { apiSend, emptyToNull } from "../../lib/api";
import { formatDateTime, statusFor } from "../../lib/format";
import type { AppData } from "../types";
import type { DashboardResource, OpnsenseImportSuggestionDto } from "../../../shared/types";
import type { HealthCheckDto } from "../../lib/api";

export type ServiceTab = "resource" | "check";

const serviceTabs: Array<{ id: ServiceTab; label: string }> = [
  { id: "resource", label: "Services" },
  { id: "check", label: "Checks" }
];

type EditMode = "resource" | "check" | null;
type FormMode = "group" | "resource" | "check" | null;

type ServiceTemplate = {
  name: string;
  kind: DashboardResource["kind"];
  icon: string;
  color: string;
  url: string;
  description: string;
  groupHint: string;
};

const serviceTemplates: ServiceTemplate[] = [
  { name: "Portainer", kind: "docker", icon: "portainer", color: "#60a5fa", url: "https://portainer.lab.local", description: "Docker stack management.", groupHint: "Applications" },
  { name: "Proxmox", kind: "server", icon: "proxmox", color: "#f97316", url: "https://proxmox.lab.local:8006", description: "Virtualization cluster.", groupHint: "Infrastructure" },
  { name: "Home Assistant", kind: "app", icon: "home-assistant", color: "#38bdf8", url: "https://homeassistant.lab.local", description: "Home automation controller.", groupHint: "Applications" },
  { name: "Pi-hole", kind: "app", icon: "pi-hole", color: "#ef4444", url: "https://pihole.lab.local/admin", description: "DNS filtering and local resolver.", groupHint: "Network" },
  { name: "TrueNAS", kind: "server", icon: "truenas", color: "#0284c7", url: "https://truenas.lab.local", description: "Storage and shares.", groupHint: "Infrastructure" },
  { name: "Jellyfin", kind: "app", icon: "jellyfin", color: "#a855f7", url: "https://jellyfin.lab.local", description: "Media library.", groupHint: "Media" },
  { name: "Grafana", kind: "app", icon: "grafana", color: "#f97316", url: "https://grafana.lab.local", description: "Dashboards and observability.", groupHint: "Monitoring" },
  { name: "Nginx Proxy Manager", kind: "app", icon: "nginx-proxy-manager", color: "#22c55e", url: "https://npm.lab.local", description: "Reverse proxy management.", groupHint: "Network" },
  { name: "Vaultwarden", kind: "app", icon: "vaultwarden", color: "#64748b", url: "https://vaultwarden.lab.local", description: "Password vault service.", groupHint: "Applications" },
  { name: "UniFi", kind: "app", icon: "unifi", color: "#0ea5e9", url: "https://unifi.lab.local", description: "Network controller.", groupHint: "Network" },
  { name: "Nextcloud", kind: "app", icon: "nextcloud", color: "#2563eb", url: "https://nextcloud.lab.local", description: "Private cloud files.", groupHint: "Applications" },
  { name: "Uptime Kuma", kind: "app", icon: "uptime-kuma", color: "#22c55e", url: "https://uptime.lab.local", description: "External uptime monitor.", groupHint: "Monitoring" }
];

function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required={required} />
    </label>
  );
}

export function ServicesView({
  data,
  onRefresh,
  autoPingIntervalSeconds,
  openAddServiceForm,
  onOpenAddServiceFormHandled,
  editServiceId,
  onEditServiceHandled
}: {
  data: AppData;
  onRefresh: () => Promise<void>;
  autoPingIntervalSeconds: number;
  openAddServiceForm?: boolean;
  onOpenAddServiceFormHandled?: () => void;
  editServiceId?: string | null;
  onEditServiceHandled?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ServiceTab>("resource");
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editResource, setEditResource] = useState<DashboardResource | null>(null);
  const [resourceDraft, setResourceDraft] = useState<Partial<DashboardResource> | null>(null);
  const [resourceFormKey, setResourceFormKey] = useState(0);
  const [editCheck, setEditCheck] = useState<HealthCheckDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editResource) setActiveTab("resource");
    if (editCheck) setActiveTab("check");
  }, [editResource, editCheck]);

  useEffect(() => {
    if (!openAddServiceForm) {
      return;
    }
    cancelEdit();
    setActiveTab("resource");
    setFormMode("resource");
    onOpenAddServiceFormHandled?.();
  }, [openAddServiceForm, onOpenAddServiceFormHandled]);

  useEffect(() => {
    if (!editServiceId) {
      return;
    }
    const resource = data.resources.find((item) => item.id === editServiceId);
    if (resource) {
      startEditResource(resource);
    }
    onEditServiceHandled?.();
  }, [editServiceId, data.resources, onEditServiceHandled]);

  function startEditResource(resource: DashboardResource) {
    setEditResource(resource);
    setResourceDraft(null);
    setEditMode("resource");
    setEditCheck(null);
    setFormMode("resource");
  }

  function startEditCheck(check: HealthCheckDto) {
    setEditCheck(check);
    setEditMode("check");
    setEditResource(null);
    setFormMode("check");
  }

  function cancelEdit() {
    setEditMode(null);
    setFormMode(null);
    setEditResource(null);
    setResourceDraft(null);
    setEditCheck(null);
  }

  function groupIdForHint(groupHint: string): string | null {
    const lowerHint = groupHint.toLowerCase();
    return data.groups.find((group) => group.name.toLowerCase() === lowerHint)?.id ?? null;
  }

  function applyTemplate(template: ServiceTemplate) {
    setEditResource(null);
    setEditCheck(null);
    setEditMode(null);
    setActiveTab("resource");
    setFormMode("resource");
    setResourceDraft({
      name: template.name,
      kind: template.kind,
      url: template.url,
      description: template.description,
      icon: template.icon,
      color: template.color,
      groupId: groupIdForHint(template.groupHint),
      monitoringMode: "auto",
      manualStatus: null,
      favorite: false
    });
    setResourceFormKey((key) => key + 1);
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (form) => {
      await apiSend("/api/groups", "POST", { name: emptyToNull(form.get("name")) });
      await onRefresh();
      setFormMode(null);
    }, setActionError, setSubmitting, "Group added");
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (form) => {
      const body = {
        name: emptyToNull(form.get("name")),
        kind: form.get("kind"),
        url: emptyToNull(form.get("url")),
        host: emptyToNull(form.get("host")),
        icon: emptyToNull(form.get("icon")),
        color: emptyToNull(form.get("color")),
        description: emptyToNull(form.get("description")),
        groupId: emptyToNull(form.get("groupId")),
        monitoringMode: form.get("monitoringMode"),
        manualStatus: emptyToNull(form.get("manualStatus")),
        favorite: form.get("favorite") === "on"
      };

      if (editResource) {
        await apiSend(`/api/resources/${editResource.id}`, "PATCH", body);
        cancelEdit();
        await onRefresh();
        return "skip-reset";
      }

      await apiSend("/api/resources", "POST", body);
      await onRefresh();
      setFormMode(null);
      setResourceDraft(null);
    }, setActionError, setSubmitting, editResource ? "Resource updated" : "Resource added");
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (form) => {
      const body = {
        resourceId: form.get("resourceId"),
        type: form.get("type"),
        target: emptyToNull(form.get("target")),
        intervalSeconds: Number.isInteger(Number(form.get("intervalSeconds")))
          ? Number(form.get("intervalSeconds"))
          : autoPingIntervalSeconds,
        timeoutMs: Number(form.get("timeoutMs") || 3000),
        failureThreshold: Number(form.get("failureThreshold") || 1),
        successThreshold: Number(form.get("successThreshold") || 1),
        enabled: true
      };

      if (editCheck) {
        await apiSend(`/api/health-checks/${editCheck.id}`, "PATCH", body);
        cancelEdit();
        await onRefresh();
        return "skip-reset";
      }

      await apiSend("/api/health-checks", "POST", body);
      await onRefresh();
      setFormMode(null);
    }, setActionError, setSubmitting, editCheck ? "Health check updated" : "Health check added");
  }

  async function remove(path: string, label: string) {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    await runFormAction(async () => {
      await apiSend(path, "DELETE");
      await onRefresh();
    }, setActionError, setSubmitting);
  }

  async function toggleCheckEnabled(check: HealthCheckDto) {
    await runFormAction(async () => {
      await apiSend(`/api/health-checks/${check.id}`, "PATCH", { enabled: !check.enabled });
      await onRefresh();
    }, setActionError, setSubmitting, check.enabled ? "Health check paused" : "Health check resumed");
  }

  async function patchResource(resource: DashboardResource, body: Record<string, unknown>) {
    await runFormAction(async () => {
      await apiSend(`/api/resources/${resource.id}`, "PATCH", body);
      await onRefresh();
    }, setActionError, setSubmitting);
  }

  async function duplicateResource(resource: DashboardResource) {
    await runFormAction(async () => {
      await apiSend("/api/resources", "POST", {
        name: `${resource.name} Copy`,
        kind: resource.kind,
        url: resource.url,
        host: resource.host,
        icon: resource.icon,
        color: resource.color,
        description: resource.description,
        groupId: resource.groupId,
        monitoringMode: resource.monitoringMode,
        manualStatus: resource.manualStatus,
        favorite: false,
        sortOrder: resource.sortOrder + 1
      });
      await onRefresh();
    }, setActionError, setSubmitting, "Service duplicated");
  }

  function resourceMatchesSuggestion(resource: DashboardResource, suggestion: OpnsenseImportSuggestionDto): boolean {
    const sameName = resource.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase();
    const sameHost = Boolean(suggestion.host && resource.host === suggestion.host);
    const sameUrl = Boolean(suggestion.url && resource.url === suggestion.url);
    return sameName || sameHost || sameUrl;
  }

  async function importSuggestion(suggestion: OpnsenseImportSuggestionDto, confirm = true) {
    if (confirm && !window.confirm(`Import "${suggestion.name}" into the service catalog?`)) return;
    await apiSend("/api/resources", "POST", {
      name: suggestion.name,
      kind: suggestion.kind,
      url: suggestion.url,
      host: suggestion.host,
      icon: suggestion.icon,
      color: suggestion.color,
      description: suggestion.description,
      groupId: groupIdForHint("Network"),
      monitoringMode: "auto",
      manualStatus: null,
      favorite: false
    });
  }

  async function importAllSuggestions(suggestions: OpnsenseImportSuggestionDto[]) {
    if (!window.confirm(`Import ${suggestions.length} OPNsense resource${suggestions.length === 1 ? "" : "s"}?`)) return;
    await runFormAction(async () => {
      for (const suggestion of suggestions) {
        await importSuggestion(suggestion, false);
      }
      await onRefresh();
    }, setActionError, setSubmitting, "OPNsense resources imported");
  }

  async function importOneSuggestion(suggestion: OpnsenseImportSuggestionDto) {
    await runFormAction(async () => {
      await importSuggestion(suggestion);
      await onRefresh();
    }, setActionError, setSubmitting, "OPNsense resource imported");
  }

  function beginCreate(mode: FormMode, tab: ServiceTab) {
    cancelEdit();
    setResourceFormKey((key) => key + 1);
    setActiveTab(tab);
    setFormMode(mode);
  }

  function switchTab(tab: ServiceTab) {
    cancelEdit();
    setActiveTab(tab);
  }

  async function moveResource(resource: DashboardResource, direction: -1 | 1) {
    const ordered = [...data.resources].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    const index = ordered.findIndex((item) => item.id === resource.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    await runFormAction(async () => {
      await apiSend(`/api/resources/${resource.id}`, "PATCH", { sortOrder: swap.sortOrder });
      await apiSend(`/api/resources/${swap.id}`, "PATCH", { sortOrder: resource.sortOrder });
      await onRefresh();
    }, setActionError, setSubmitting);
  }

  const opnsenseSuggestions = useMemo(() => {
    const suggestions = data.dashboard.integrations.flatMap((source) =>
      source.latestSnapshot?.importSuggestions ?? []
    );
    return suggestions.filter((suggestion, index, list) =>
      list.findIndex((item) => item.id === suggestion.id) === index &&
      !data.resources.some((resource) => resourceMatchesSuggestion(resource, suggestion))
    );
  }, [data.dashboard.integrations, data.resources]);

  const resourceDefaults = editResource ?? resourceDraft;

  return (
    <main className="view-shell services-view">
      <PageHeader
        title="Services"
        subtitle={`${data.resources.length} services · ${data.checks.length} checks`}
        actions={
          <>
            <button className="icon-text-button" type="button" onClick={() => void onRefresh()}>
              <Wifi size={16} /> Sync
            </button>
            <button className="primary-button header-primary-action" type="button" onClick={() => beginCreate("resource", "resource")}>
              <Plus size={16} /> Add service
            </button>
          </>
        }
      />

      <FormErrorBanner message={actionError} />

      <section className="dashboard-overview dashboard-compact-metrics">
        <MetricCard icon={<Server size={18} />} label="Services" value={data.resources.length} tone="accent" />
        <MetricCard icon={<Activity size={18} />} label="Checks" value={data.checks.length} />
      </section>

      <div className="service-tabs">
        {serviceTabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            onClick={() => switchTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "resource" ? (
        <section className="table-panel services-panel">
          <div className="section-heading service-list-heading">
            <h3>Service catalog</h3>
            <div className="section-actions">
              <button className="icon-text-button" type="button" onClick={() => beginCreate("group", "resource")}>
                <Plus size={14} /> Group
              </button>
              <button className="primary-button header-primary-action" type="button" onClick={() => beginCreate("resource", "resource")}>
                <Plus size={14} /> Service
              </button>
            </div>
          </div>

          <div className="service-template-strip" aria-label="Service templates">
            <span>Templates</span>
            {serviceTemplates.map((template) => (
              <button key={template.name} type="button" onClick={() => applyTemplate(template)}>
                {template.name}
              </button>
            ))}
          </div>

          {data.dashboard.integrations.length > 0 ? (
            <div className="integration-import-panel">
              <div className="section-heading compact-section-heading">
                <h3><ShieldCheck size={15} /> OPNsense imports</h3>
                {opnsenseSuggestions.length > 0 ? (
                  <button className="icon-text-button" type="button" disabled={submitting} onClick={() => void importAllSuggestions(opnsenseSuggestions)}>
                    <Plus size={14} /> Import all
                  </button>
                ) : null}
              </div>
              {opnsenseSuggestions.length > 0 ? (
                <div className="row-list integration-import-list">
                  {opnsenseSuggestions.slice(0, 12).map((suggestion) => (
                    <div className="data-row data-row-wide service-data-row" key={suggestion.id}>
                      <span>
                        <strong>{suggestion.name}</strong>
                        <small>{suggestion.source} · {suggestion.host ?? suggestion.url ?? "no address"} · {suggestion.description}</small>
                      </span>
                      <button className="icon-button" type="button" title="Import service" disabled={submitting} onClick={() => void importOneSuggestion(suggestion)}>
                        <Plus size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No new OPNsense resources to import from the latest sample.</p>
              )}
            </div>
          ) : null}

          {formMode === "group" ? (
            <form className="tool-panel service-form-panel" onSubmit={submitGroup}>
              <h3>New group</h3>
              <Field label="Name" name="name" required />
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={submitting}><Plus size={16} /> Add group</button>
                <button className="icon-text-button" type="button" onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : null}

          {(formMode === "resource" || editResource) ? (
            <form key={editResource?.id ?? `new-resource-${resourceFormKey}`} className="tool-panel service-form-panel service-form-grid" onSubmit={submitResource}>
              <h3>{editResource ? <><Pencil size={15} /> Edit service</> : "New service"}</h3>
              <Field label="Name" name="name" defaultValue={resourceDefaults?.name ?? ""} required />
              <label>
                Kind
                <select name="kind" defaultValue={resourceDefaults?.kind ?? "app"}>
                  {RESOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
              </label>
              <Field label="URL" name="url" placeholder="https://service.local" defaultValue={resourceDefaults?.url ?? ""} />
              <Field label="Host" name="host" placeholder="192.168.1.10" defaultValue={resourceDefaults?.host ?? ""} />
              <Field
                label="Icon (auto-detected from name if empty)"
                name="icon"
                placeholder="plex, home-assistant, or https://… image"
                defaultValue={resourceDefaults?.icon ?? ""}
              />
              <label>
                Color
                <input name="color" type="color" defaultValue={resourceDefaults?.color ?? "#2dd4bf"} style={{ height: 38, cursor: "pointer" }} />
              </label>
              <label>
                Group
                <select name="groupId" defaultValue={resourceDefaults?.groupId ?? ""}>
                  <option value="">Ungrouped</option>
                  {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label>
                Monitoring
                <select name="monitoringMode" defaultValue={resourceDefaults?.monitoringMode ?? "auto"}>
                  {MONITORING_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode === "auto" ? "Automatic checks" : mode === "manual" ? "Manual status" : "Disabled"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Manual status
                <select name="manualStatus" defaultValue={resourceDefaults?.manualStatus ?? ""}>
                  <option value="">Unknown</option>
                  {HEALTH_STATUSES.filter((status) => status !== "unknown").map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea name="description" rows={2} defaultValue={resourceDefaults?.description ?? ""} />
              </label>
              <label className="checkbox-row">
                <input name="favorite" type="checkbox" defaultChecked={resourceDefaults?.favorite} />
                Favorite
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={submitting}><Save size={16} /> {editResource ? "Update service" : "Save service"}</button>
                <button className="icon-text-button" type="button" onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : null}

          <div className="row-list service-catalog-list">
            {data.resources.map((resource, index, list) => (
              <div className="data-row data-row-wide service-data-row" key={resource.id}>
                <ServiceIcon resource={resource} size={28} />
                <span>
                  <strong>{resource.name}</strong>
                  <small>
                    {resource.kind}{resource.url ? ` · ${resource.url}` : ""}{resource.host ? ` · ${resource.host}` : ""}
                    {resource.monitoringMode !== "auto" ? ` · ${resource.monitoringMode}` : ""}
                  </small>
                </span>
                <StatusBadge status={statusFor(resource)} />
                <select
                  className="inline-row-select"
                  value={resource.monitoringMode}
                  aria-label={`Monitoring mode for ${resource.name}`}
                  onChange={(event) => void patchResource(resource, {
                    monitoringMode: event.target.value,
                    manualStatus: event.target.value === "auto" ? null : resource.manualStatus ?? "unknown"
                  })}
                >
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                  <option value="disabled">Off</option>
                </select>
                <select
                  className="inline-row-select"
                  value={resource.manualStatus ?? "unknown"}
                  aria-label={`Manual status for ${resource.name}`}
                  disabled={resource.monitoringMode === "auto"}
                  onChange={(event) => void patchResource(resource, {
                    monitoringMode: resource.monitoringMode === "auto" ? "manual" : resource.monitoringMode,
                    manualStatus: event.target.value
                  })}
                >
                  {HEALTH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <span className="service-row-actions">
                  <button className="icon-button" type="button" aria-label={`Move ${resource.name} up`} disabled={index === 0} onClick={() => void moveResource(resource, -1)}>
                    <ChevronUp size={14} />
                  </button>
                  <button className="icon-button" type="button" aria-label={`Move ${resource.name} down`} disabled={index === list.length - 1} onClick={() => void moveResource(resource, 1)}>
                    <ChevronDown size={14} />
                  </button>
                  <button className="icon-button" type="button" aria-label={`Edit ${resource.name}`} onClick={() => startEditResource(resource)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-button" type="button" aria-label={`Duplicate ${resource.name}`} onClick={() => void duplicateResource(resource)}>
                    <Copy size={14} />
                  </button>
                  <button className="icon-button danger" type="button" aria-label={`Delete ${resource.name}`} onClick={() => void remove(`/api/resources/${resource.id}`, resource.name)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            ))}
            {data.resources.length === 0 ? <p className="muted-copy">No services yet.</p> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "check" ? (
        <section className="table-panel services-panel">
          <div className="section-heading service-list-heading">
            <h3>Health checks</h3>
            <button className="primary-button header-primary-action" type="button" onClick={() => beginCreate("check", "check")}>
              <Plus size={14} /> Add check
            </button>
          </div>

          {(formMode === "check" || editCheck) ? (
            <form key={editCheck?.id ?? "new-check"} className="tool-panel service-form-panel service-form-grid" onSubmit={submitCheck}>
              <h3>{editCheck ? <><Pencil size={15} /> Edit check</> : "New health check"}</h3>
              <label>
                Service
                <select name="resourceId" required defaultValue={editCheck?.resourceId ?? ""}>
                  <option value="">Select service</option>
                  {data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                </select>
              </label>
              <label>
                Type
                <select name="type" defaultValue={editCheck?.type ?? "http"}>
                  {HEALTH_CHECK_TYPES.map((type) => <option key={type} value={type}>{type === "ssl" ? "SSL certificate" : type}</option>)}
                </select>
              </label>
              <Field label="Target" name="target" placeholder="https://service.local or host:443" defaultValue={editCheck?.target} required />
              <Field
                label="Interval (seconds)"
                name="intervalSeconds"
                type="number"
                placeholder="60"
                defaultValue={editCheck?.intervalSeconds?.toString() ?? String(autoPingIntervalSeconds)}
                required
              />
              <Field
                label="Timeout (ms)"
                name="timeoutMs"
                type="number"
                placeholder="3000"
                defaultValue={editCheck?.timeoutMs?.toString()}
                required
              />
              <Field label="Failure threshold" name="failureThreshold" type="number" placeholder="1" defaultValue={editCheck?.failureThreshold?.toString()} />
              <Field label="Recovery threshold" name="successThreshold" type="number" placeholder="1" defaultValue={editCheck?.successThreshold?.toString()} />
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={submitting}><Activity size={16} /> {editCheck ? "Update check" : "Add check"}</button>
                <button className="icon-text-button" type="button" onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : null}

          <div className="row-list">
            {data.checks.map((check) => (
              <div className="data-row data-row-wide service-data-row" key={check.id}>
                <span>
                  <strong>{check.resource?.name ?? check.target}</strong>
                  <small>{check.type} · {check.target} · every {check.intervalSeconds}s · {check.enabled ? "enabled" : "disabled"} · {check.latestCheckedAt ? `last ${formatDateTime(check.latestCheckedAt)}` : "never"}</small>
                </span>
                <StatusBadge status={check.latestStatus} />
                <button className="icon-button" type="button" aria-label={`${check.enabled ? "Pause" : "Resume"} ${check.type} check for ${check.resource?.name ?? check.target}`} onClick={() => void toggleCheckEnabled(check)}>
                  {check.enabled ? <Activity size={14} /> : <Activity size={14} style={{ opacity: 0.4 }} />}
                </button>
                <button className="icon-button" type="button" aria-label={`Edit ${check.type} check for ${check.resource?.name ?? check.target}`} onClick={() => startEditCheck(check)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" aria-label={`Delete ${check.type} check for ${check.resource?.name ?? check.target}`} onClick={() => void remove(`/api/health-checks/${check.id}`, check.target)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.checks.length === 0 ? <p className="muted-copy">No checks configured.</p> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
