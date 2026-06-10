import { Activity, ChevronDown, ChevronUp, Database, Pencil, Pin, Plus, Save, Server, Tag, Trash2, Wifi, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { HEALTH_CHECK_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { MetricCard, PageHeader, StatusBadge } from "../../components/Primitives";
import { TagPicker, readTagIds } from "../../components/TagPicker";
import { BackupRestoreView } from "./BackupRestoreView";
import type { HealthCheckDto, NoteDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction, runFormSubmit } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";
import type { DashboardResource } from "../../../shared/types";

export type ServiceTab = "resource" | "check" | "notes" | "tags" | "backup";

const serviceTabs: Array<{ id: ServiceTab; label: string }> = [
  { id: "resource", label: "Services" },
  { id: "check", label: "Checks" },
  { id: "notes", label: "Notes" },
  { id: "tags", label: "Tags" },
  { id: "backup", label: "Backup" }
];

type EditMode = "resource" | "check" | null;
type FormMode = "group" | "resource" | "check" | "note" | "tag" | null;

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
  activeTab,
  onTabChange
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  activeTab: ServiceTab;
  onTabChange: (tab: ServiceTab) => void;
}) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editResource, setEditResource] = useState<DashboardResource | null>(null);
  const [editCheck, setEditCheck] = useState<HealthCheckDto | null>(null);
  const [editNote, setEditNote] = useState<NoteDto | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteResourceId, setNoteResourceId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editResource) onTabChange("resource");
    if (editCheck) onTabChange("check");
  }, [editResource, editCheck, onTabChange]);

  function startEditResource(r: DashboardResource) { setEditResource(r); setEditMode("resource"); setEditCheck(null); setEditNote(null); setFormMode("resource"); }
  function startEditCheck(c: HealthCheckDto) { setEditCheck(c); setEditMode("check"); setEditResource(null); setEditNote(null); setFormMode("check"); }
  function cancelEdit() {
    setEditMode(null);
    setFormMode(null);
    setEditResource(null);
    setEditCheck(null);
    setEditNote(null);
    setNoteTitle("");
    setNoteBody("");
    setNoteResourceId("");
  }
  function startEditNote(note: NoteDto) {
    setEditResource(null);
    setEditCheck(null);
    setEditMode(null);
    setEditNote(note);
    setNoteTitle(note.title);
    setNoteBody(note.body);
    setNoteResourceId(note.resourceId ?? "");
    setFormMode("note");
    onTabChange("notes");
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (f) => {
      await apiSend("/api/groups", "POST", { name: emptyToNull(f.get("name")) });
      await onRefresh();
      setFormMode(null);
    }, setActionError, setSubmitting, "Group added");
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (f) => {
      const body = {
        name: emptyToNull(f.get("name")),
        kind: f.get("kind"),
        url: emptyToNull(f.get("url")),
        host: emptyToNull(f.get("host")),
        icon: emptyToNull(f.get("icon")),
        color: emptyToNull(f.get("color")),
        description: emptyToNull(f.get("description")),
        notes: emptyToNull(f.get("notes")),
        groupId: emptyToNull(f.get("groupId")),
        favorite: f.get("favorite") === "on",
        tagIds: readTagIds(f)
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
    await runFormSubmit(event, async (f) => {
      const body = {
        resourceId: f.get("resourceId"),
        type: f.get("type"),
        target: emptyToNull(f.get("target")),
        intervalSeconds: Number(f.get("intervalSeconds") || 60),
        timeoutMs: Number(f.get("timeoutMs") || 3000),
        failureThreshold: Number(f.get("failureThreshold") || 1),
        successThreshold: Number(f.get("successThreshold") || 1),
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

  async function submitTag(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (f) => {
      await apiSend("/api/tags", "POST", {
        name: emptyToNull(f.get("name")),
        color: emptyToNull(f.get("color")),
        type: emptyToNull(f.get("type")) ?? "general"
      });
      await onRefresh();
      setFormMode(null);
    }, setActionError, setSubmitting, "Tag created");
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!noteTitle.trim() || !noteBody.trim()) return;
    await runFormAction(async () => {
      const resourceId = emptyToNull(noteResourceId) ?? null;
      if (editNote) {
        await apiSend(`/api/notes/${editNote.id}`, "PATCH", { title: noteTitle, body: noteBody, resourceId });
        setEditNote(null);
      } else {
        await apiSend("/api/notes", "POST", { title: noteTitle, body: noteBody, pinned: false, resourceId });
      }
      setNoteTitle("");
      setNoteBody("");
      setNoteResourceId("");
      setFormMode(null);
      await onRefresh();
    }, setActionError, setSubmitting, editNote ? "Note updated" : "Note added");
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

  async function togglePin(note: NoteDto) {
    await apiSend(`/api/notes/${note.id}`, "PATCH", { pinned: !note.pinned });
    await onRefresh();
  }

  async function moveResource(resource: DashboardResource, direction: -1 | 1) {
    const ordered = [...data.resources].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const index = ordered.findIndex((item) => item.id === resource.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    await apiSend(`/api/resources/${resource.id}`, "PATCH", { sortOrder: swap.sortOrder });
    await apiSend(`/api/resources/${swap.id}`, "PATCH", { sortOrder: resource.sortOrder });
    await onRefresh();
  }

  function switchTab(tab: ServiceTab) {
    cancelEdit();
    onTabChange(tab);
  }

  function beginCreate(mode: Exclude<FormMode, null>, tab: ServiceTab) {
    cancelEdit();
    onTabChange(tab);
    setFormMode(mode);
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

      <section className="dashboard-overview">
        <MetricCard icon={<Server size={18} />} label="Services" value={data.resources.length} tone="accent" />
        <MetricCard icon={<Wifi size={18} />} label="Launch URLs" value={data.resources.filter((resource) => resource.url).length} />
        <MetricCard icon={<Activity size={18} />} label="Checks" value={data.checks.length} />
        <MetricCard icon={<Database size={18} />} label="Groups" value={data.groups.length} />
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

      {activeTab === "backup" ? (
        <BackupRestoreView onRefresh={onRefresh} />
      ) : null}

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
              {editResource ? <p className="muted-copy" style={{ margin: 0 }}>Editing <strong>{editResource.name}</strong></p> : null}
              <Field label="Name" name="name" defaultValue={editResource?.name} required />
              <label>
                Kind
                <select name="kind" defaultValue={editResource?.kind ?? "app"}>
                  {RESOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
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
                  {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label>Tags<TagPicker tags={data.tags} type="resource" defaultSelected={editResource?.tags?.map((tag) => tag.id) ?? []} /></label>
              <label>Description<textarea name="description" rows={2} defaultValue={editResource?.description ?? ""} /></label>
              <label>Notes<textarea name="notes" rows={2} defaultValue={editResource?.notes ?? ""} /></label>
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
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/resources/${resource.id}`, resource.name)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.resources.length === 0 ? (
              <p className="muted-copy">
                No services saved yet. <button className="link-button" type="button" onClick={() => beginCreate("resource", "resource")}>Add one</button>
              </p>
            ) : null}
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
              {editCheck ? <p className="muted-copy" style={{ margin: 0 }}>Editing <strong>{editCheck.target}</strong></p> : null}
              <label>
                Service
                <select name="resourceId" required defaultValue={editCheck?.resourceId ?? ""}>
                  <option value="">Select service</option>
                  {data.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label>
                Type
                <select name="type" defaultValue={editCheck?.type ?? "http"}>
                  {HEALTH_CHECK_TYPES.map((t) => <option key={t} value={t}>{t === "ssl" ? "SSL certificate" : t}</option>)}
                </select>
              </label>
              <Field label="Target" name="target" placeholder="https://service.local or host:443" defaultValue={editCheck?.target} required />
              <Field label="Interval (seconds)" name="intervalSeconds" type="number" placeholder="60" defaultValue={editCheck?.intervalSeconds?.toString()} />
              <Field label="Timeout (ms)" name="timeoutMs" type="number" placeholder="3000" defaultValue={editCheck?.timeoutMs?.toString()} />
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
                  <small>{check.type} · {check.target} · every {check.intervalSeconds}s</small>
                </span>
                <StatusBadge status={check.latestStatus} />
                <button className="icon-button" type="button" title={check.enabled ? "Pause" : "Resume"} onClick={() => toggleCheckEnabled(check)}>
                  {check.enabled ? <Activity size={14} /> : <Activity size={14} style={{ opacity: 0.4 }} />}
                </button>
                <button className="icon-button" type="button" title="Edit" onClick={() => startEditCheck(check)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/health-checks/${check.id}`, check.target)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.checks.length === 0 ? <p className="muted-copy">No checks configured.</p> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <section className="table-panel services-panel">
          <div className="section-heading service-list-heading">
            <h3>Notes</h3>
            <button className="primary-button header-primary-action" type="button" onClick={() => beginCreate("note", "notes")}>
              <Plus size={14} /> Add note
            </button>
          </div>

          {(formMode === "note" || editNote) ? (
            <form className="tool-panel service-form-panel" onSubmit={submitNote}>
              <h3>{editNote ? "Edit note" : "New note"}</h3>
              <label>
                Title
                <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required placeholder="Note title" />
              </label>
              <label>
                Service
                <select value={noteResourceId} onChange={(e) => setNoteResourceId(e.target.value)}>
                  <option value="">No linked service</option>
                  {data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                </select>
              </label>
              <label>
                Body
                <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={4} required placeholder="Note content..." />
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> {editNote ? "Update note" : "Add note"}</button>
                <button className="icon-text-button" type="button" onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : null}

          <div className="row-list">
            {data.notes.map((note) => (
              <div className="data-row data-row-wide service-data-row" key={note.id}>
                <span>
                  <strong>{note.title}{note.pinned ? " pinned" : ""}</strong>
                  <small>
                    {note.resourceId ? `${data.resources.find((resource) => resource.id === note.resourceId)?.name ?? "Service"} · ` : ""}
                    {note.body.slice(0, 80)}{note.body.length > 80 ? "..." : ""} · {formatDateTime(note.updatedAt)}
                  </small>
                </span>
                <button className={`icon-button ${note.pinned ? "is-active" : ""}`} type="button" title={note.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(note)}>
                  <Pin size={14} />
                </button>
                <button className="icon-button" type="button" title="Edit" onClick={() => startEditNote(note)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/notes/${note.id}`, note.title)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.notes.length === 0 ? (
              <p className="muted-copy">
                No notes yet. <button className="link-button" type="button" onClick={() => beginCreate("note", "notes")}>Create one</button>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "tags" ? (
        <section className="table-panel services-panel">
          <div className="section-heading service-list-heading">
            <h3>Tags</h3>
            <button className="primary-button header-primary-action" type="button" onClick={() => beginCreate("tag", "tags")}>
              <Plus size={14} /> Add tag
            </button>
          </div>

          {formMode === "tag" ? (
            <form className="tool-panel service-form-panel" onSubmit={submitTag}>
              <h3><Tag size={15} /> Create tag</h3>
              <Field label="Name" name="name" required />
              <Field label="Color" name="color" type="color" defaultValue="#2dd4bf" />
              <label>
                Type
                <select name="type" defaultValue="general">
                  <option value="general">General</option>
                  <option value="resource">Service</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={submitting}><Plus size={16} /> Add tag</button>
                <button className="icon-text-button" type="button" onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : null}

          <div className="row-list">
            {data.tags.map((tag) => (
              <div className="data-row service-data-row" key={tag.id}>
                <span>
                  <strong>{tag.name}</strong>
                  <small>{tag.type}</small>
                </span>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/tags/${tag.id}`, tag.name)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.tags.length === 0 ? <p className="muted-copy">No tags yet.</p> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
