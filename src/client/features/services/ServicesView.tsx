import { Activity, ChevronDown, ChevronUp, Plus, Pencil, Save, Server, Trash2, Wifi } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { HEALTH_CHECK_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { MetricCard, PageHeader, StatusBadge } from "../../components/Primitives";
import { FormErrorBanner, runFormAction, runFormSubmit } from "../../lib/forms";
import { apiSend, emptyToNull } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { AppData } from "../types";
import type { DashboardResource } from "../../../shared/types";
import type { HealthCheckDto } from "../../lib/api";

export type ServiceTab = "resource" | "check";

const serviceTabs: Array<{ id: ServiceTab; label: string }> = [
  { id: "resource", label: "Services" },
  { id: "check", label: "Checks" }
];

type EditMode = "resource" | "check" | null;
type FormMode = "group" | "resource" | "check" | null;

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
  onOpenAddServiceFormHandled
}: {
  data: AppData;
  onRefresh: () => Promise<void>;
  autoPingIntervalSeconds: number;
  openAddServiceForm?: boolean;
  onOpenAddServiceFormHandled?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ServiceTab>("resource");
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editResource, setEditResource] = useState<DashboardResource | null>(null);
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

  function startEditResource(resource: DashboardResource) {
    setEditResource(resource);
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
    setEditCheck(null);
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
    await apiSend(`/api/health-checks/${check.id}`, "PATCH", { enabled: !check.enabled });
    await onRefresh();
  }

  function beginCreate(mode: FormMode, tab: ServiceTab) {
    cancelEdit();
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
    await apiSend(`/api/resources/${resource.id}`, "PATCH", { sortOrder: swap.sortOrder });
    await apiSend(`/api/resources/${swap.id}`, "PATCH", { sortOrder: resource.sortOrder });
    await onRefresh();
  }

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
            <form key={editResource?.id ?? "new-resource"} className="tool-panel service-form-panel service-form-grid" onSubmit={submitResource}>
              <h3>{editResource ? <><Pencil size={15} /> Edit service</> : "New service"}</h3>
              <Field label="Name" name="name" defaultValue={editResource?.name} required />
              <label>
                Kind
                <select name="kind" defaultValue={editResource?.kind ?? "app"}>
                  {RESOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                </select>
              </label>
              <Field label="URL" name="url" placeholder="https://service.local" defaultValue={editResource?.url ?? ""} />
              <Field label="Host" name="host" placeholder="192.168.1.10" defaultValue={editResource?.host ?? ""} />
              <Field label="Icon label" name="icon" defaultValue={editResource?.icon ?? ""} />
              <label>
                Color
                <input name="color" type="color" defaultValue={editResource?.color ?? "#2dd4bf"} style={{ height: 38, cursor: "pointer" }} />
              </label>
              <label>
                Group
                <select name="groupId" defaultValue={editResource?.groupId ?? ""}>
                  <option value="">Ungrouped</option>
                  {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label>Notes</label>
              <textarea name="description" rows={2} defaultValue={editResource?.description ?? ""} />
              <label className="checkbox-row">
                <input name="favorite" type="checkbox" defaultChecked={editResource?.favorite} />
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
                <span>
                  <strong>{resource.name}</strong>
                  <small>{resource.kind}{resource.url ? ` · ${resource.url}` : ""}{resource.host ? ` · ${resource.host}` : ""}</small>
                </span>
                <StatusBadge status={resource.healthChecks?.some((check) => check.latestStatus === "offline") ? "offline" : resource.healthChecks?.length ? "online" : "unknown"} />
                <button className="icon-button" type="button" title="Move up" disabled={index === 0} onClick={() => void moveResource(resource, -1)}>
                  <ChevronUp size={14} />
                </button>
                <button className="icon-button" type="button" title="Move down" disabled={index === list.length - 1} onClick={() => void moveResource(resource, 1)}>
                  <ChevronDown size={14} />
                </button>
                <button className="icon-button" type="button" title="Edit" onClick={() => startEditResource(resource)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => void remove(`/api/resources/${resource.id}`, resource.name)}>
                  <Trash2 size={14} />
                </button>
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
                <button className="icon-button" type="button" title={check.enabled ? "Pause" : "Resume"} onClick={() => void toggleCheckEnabled(check)}>
                  {check.enabled ? <Activity size={14} /> : <Activity size={14} style={{ opacity: 0.4 }} />}
                </button>
                <button className="icon-button" type="button" title="Edit" onClick={() => startEditCheck(check)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => void remove(`/api/health-checks/${check.id}`, check.target)}>
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
