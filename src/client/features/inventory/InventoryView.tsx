import { Activity, ChevronDown, ChevronUp, Database, KeyRound, Pencil, Pin, Plus, Save, Server, Tag, TerminalSquare, Trash2, Wifi, X, Zap } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { CONNECTION_TYPES, HEALTH_CHECK_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { MetricCard, StatusBadge } from "../../components/Primitives";
import { TagPicker, readTagIds } from "../../components/TagPicker";
import { BackupRestoreView } from "./BackupRestoreView";
import type { HealthCheckDto, NoteDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";
import type { DashboardResource } from "../../../shared/types";
import type { ConnectionDto } from "../../lib/api";

export type InventoryTab = "resource" | "connection" | "credential" | "check" | "notes" | "tags" | "backup";

const inventoryTabs: Array<{ id: InventoryTab; label: string }> = [
  { id: "resource", label: "Resource" },
  { id: "connection", label: "Connection" },
  { id: "credential", label: "Credential" },
  { id: "check", label: "Health Check" },
  { id: "notes", label: "Notes" },
  { id: "tags", label: "Tags" },
  { id: "backup", label: "Backup" }
];

type EditMode = "resource" | "connection" | "check" | null;

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

export function InventoryView({
  data,
  onRefresh,
  activeTab,
  onTabChange
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  activeTab: InventoryTab;
  onTabChange: (tab: InventoryTab) => void;
}) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [editResource, setEditResource] = useState<DashboardResource | null>(null);
  const [editConnection, setEditConnection] = useState<ConnectionDto | null>(null);
  const [editCheck, setEditCheck] = useState<HealthCheckDto | null>(null);
  const [editNote, setEditNote] = useState<NoteDto | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteResourceId, setNoteResourceId] = useState("");
  const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editResource) onTabChange("resource");
    if (editConnection) onTabChange("connection");
    if (editCheck) onTabChange("check");
  }, [editResource, editConnection, editCheck, onTabChange]);

  function startEditResource(r: DashboardResource) { setEditResource(r); setEditMode("resource"); setEditConnection(null); setEditCheck(null); }
  function startEditConnection(c: ConnectionDto) { setEditConnection(c); setEditMode("connection"); setEditResource(null); setEditCheck(null); }
  function startEditCheck(c: HealthCheckDto) { setEditCheck(c); setEditMode("check"); setEditResource(null); setEditConnection(null); }
  function cancelEdit() { setEditMode(null); setEditResource(null); setEditConnection(null); setEditCheck(null); }
  function startEditNote(note: NoteDto) {
    setEditNote(note);
    setNoteTitle(note.title);
    setNoteBody(note.body);
    setNoteResourceId(note.resourceId ?? "");
    onTabChange("notes");
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const f = new FormData(event.currentTarget);
      await apiSend("/api/groups", "POST", { name: emptyToNull(f.get("name")) });
      event.currentTarget.reset();
      await onRefresh();
    }, setActionError, setSubmitting, "Group added");
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const f = new FormData(event.currentTarget);
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
      } else {
        await apiSend("/api/resources", "POST", body);
        event.currentTarget.reset();
      }
      await onRefresh();
    }, setActionError, setSubmitting, editResource ? "Resource updated" : "Resource added");
  }

  async function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const f = new FormData(event.currentTarget);
      const type = String(f.get("type"));
      const resourceId = String(f.get("resourceId"));
      const resource = data.resources.find((item) => item.id === resourceId);
      const host =
        emptyToNull(f.get("host")) ??
        emptyToNull(resource?.host ?? null) ??
        emptyToNull(resource?.url ?? null);

      if (!host) {
        throw new Error("Host is required — enter a host or pick a resource that has one");
      }

      const body = {
        resourceId,
        type,
        name: emptyToNull(f.get("name")),
        host,
        port: Number(f.get("port") || (type === "ssh" ? 22 : 3389)),
        usernameHint: emptyToNull(f.get("usernameHint")),
        credentialId: emptyToNull(f.get("credentialId")),
        folderId: emptyToNull(f.get("folderId")),
        notes: emptyToNull(f.get("notes")),
        favorite: f.get("favorite") === "on",
        tagIds: readTagIds(f)
      };
      if (editConnection) {
        await apiSend(`/api/connections/${editConnection.id}`, "PATCH", body);
        cancelEdit();
      } else {
        await apiSend("/api/connections", "POST", body);
        event.currentTarget.reset();
      }
      setConnectionTestResult(null);
      await onRefresh();
    }, setActionError, setSubmitting, editConnection ? "Connection updated" : "Connection added");
  }

  async function testConnection(form: HTMLFormElement) {
    const f = new FormData(form);
    const type = String(f.get("type"));
    const host =
      emptyToNull(f.get("host")) ??
      emptyToNull(data.resources.find((item) => item.id === String(f.get("resourceId")))?.host ?? null);
    if (!host) {
      setConnectionTestResult("Enter a host or select a resource with a host first");
      return;
    }
    try {
      const result = await apiSend<{ ok: boolean; latencyMs: number; error: string | null }>("/api/connections/test", "POST", {
        host,
        port: Number(f.get("port") || (type === "ssh" ? 22 : 3389)),
        type
      });
      setConnectionTestResult(result.ok ? `Reachable in ${result.latencyMs}ms` : result.error ?? "Unreachable");
    } catch (error) {
      setConnectionTestResult(error instanceof Error ? error.message : "Test failed");
    }
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const f = new FormData(event.currentTarget);
      await apiSend("/api/credentials", "POST", {
        label: emptyToNull(f.get("label")),
        username: emptyToNull(f.get("username")),
        password: emptyToNull(f.get("password")),
        domain: emptyToNull(f.get("domain")),
        privateKey: emptyToNull(f.get("privateKey")),
        passphrase: emptyToNull(f.get("passphrase")),
        notes: emptyToNull(f.get("notes")),
        folderId: emptyToNull(f.get("folderId")),
        tagIds: readTagIds(f)
      });
      event.currentTarget.reset();
      await onRefresh();
    }, setActionError, setSubmitting, "Credential added");
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const f = new FormData(event.currentTarget);
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
      } else {
        await apiSend("/api/health-checks", "POST", body);
        event.currentTarget.reset();
      }
      await onRefresh();
    }, setActionError, setSubmitting, editCheck ? "Health check updated" : "Health check added");
  }

  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const f = new FormData(event.currentTarget);
      await apiSend("/api/tags", "POST", {
        name: emptyToNull(f.get("name")),
        color: emptyToNull(f.get("color")),
        type: emptyToNull(f.get("type")) ?? "general"
      });
      event.currentTarget.reset();
      await onRefresh();
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

  const credentialFolders = data.folders.filter((f) => f.type === "credential" || f.type === "mixed");
  const connectionFolders = data.folders.filter((f) => f.type === "connection" || f.type === "mixed");

  return (
    <main className="view-shell">
      <header className="view-header">
        <div>
          <h2>Inventory</h2>
          <span>{data.resources.length} resources · {data.connections.length} connections · {data.checks.length} checks</span>
        </div>
      </header>

      <FormErrorBanner message={actionError} />

      <section className="dashboard-overview">
        <MetricCard icon={<Server size={18} />} label="Resources" value={data.resources.length} tone="accent" />
        <MetricCard icon={<TerminalSquare size={18} />} label="Connections" value={data.connections.length} />
        <MetricCard icon={<Activity size={18} />} label="Checks" value={data.checks.length} />
        <MetricCard icon={<KeyRound size={18} />} label="Vault items" value={data.credentials.length} />
        <MetricCard icon={<Database size={18} />} label="Groups" value={data.groups.length} />
      </section>

      <div className="inventory-tabs">
        {inventoryTabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "backup" ? (
        <BackupRestoreView onRefresh={onRefresh} />
      ) : (
      <>
      <div className="inventory-grid inventory-grid-single">
        {activeTab === "resource" ? (
          <>
            <form className="tool-panel" onSubmit={submitGroup}>
              <h3>Group</h3>
              <Field label="Name" name="name" required />
              <button className="primary-button" type="submit" disabled={submitting}><Plus size={16} /> Add group</button>
            </form>

            <form key={editResource?.id ?? "new-resource"} className="tool-panel" onSubmit={submitResource}>
              <h3>{editResource ? <><Pencil size={15} /> Edit resource</> : "Resource"}</h3>
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
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary-button" type="submit" disabled={submitting}><Save size={16} /> {editResource ? "Update" : "Save"}</button>
                {editResource ? <button className="icon-button" type="button" title="Cancel" onClick={cancelEdit}><X size={16} /></button> : null}
              </div>
            </form>
          </>
        ) : null}

        {activeTab === "connection" ? (
          <form key={editConnection?.id ?? "new-connection"} className="tool-panel" onSubmit={submitConnection}>
            <h3>{editConnection ? <><Pencil size={15} /> Edit connection</> : "Connection"}</h3>
            {editConnection ? <p className="muted-copy" style={{ margin: 0 }}>Editing <strong>{editConnection.name ?? editConnection.host}</strong></p> : null}
            <label>
              Resource
              <select name="resourceId" required defaultValue={editConnection?.resourceId ?? ""}>
                <option value="">Select resource</option>
                {data.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label>
              Type
              <select name="type" defaultValue={editConnection?.type ?? "rdp"}>
                {CONNECTION_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </label>
            <Field label="Name" name="name" defaultValue={editConnection?.name ?? ""} />
            <Field label="Host" name="host" placeholder="192.168.1.10 or leave blank to use resource host" defaultValue={editConnection?.host} required={Boolean(editConnection)} />
            <Field label="Port" name="port" type="number" placeholder="3389" defaultValue={editConnection?.port?.toString()} />
            <Field label="Username hint" name="usernameHint" defaultValue={editConnection?.usernameHint ?? ""} />
            <label>
              Folder
              <select name="folderId" defaultValue={editConnection?.folderId ?? ""}>
                <option value="">Unfiled</option>
                {connectionFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>
              Credential
              <select name="credentialId" defaultValue={editConnection?.credentialId ?? ""}>
                <option value="">Prompt or anonymous</option>
                {data.credentials.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label>Tags<TagPicker tags={data.tags} type="connection" defaultSelected={editConnection?.tags?.map((tag) => tag.id) ?? []} /></label>
            <label>Notes<textarea name="notes" rows={2} defaultValue={editConnection?.notes ?? ""} /></label>
            <label className="checkbox-row">
              <input name="favorite" type="checkbox" defaultChecked={editConnection?.favorite} />
              Favorite
            </label>
            {connectionTestResult ? <p className="muted-copy" style={{ margin: 0 }}>{connectionTestResult}</p> : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="primary-button" type="submit" disabled={submitting}><Save size={16} /> {editConnection ? "Update" : "Add"}</button>
              <button className="icon-text-button" type="button" onClick={(event) => testConnection(event.currentTarget.closest("form")!)}>
                <Zap size={15} /> Test connection
              </button>
              {editConnection ? <button className="icon-button" type="button" title="Cancel" onClick={cancelEdit}><X size={16} /></button> : null}
            </div>
          </form>
        ) : null}

        {activeTab === "credential" ? (
          <form className="tool-panel" onSubmit={submitCredential}>
            <h3>Credential</h3>
            <Field label="Label" name="label" placeholder="Lab admin" required />
            <Field label="Username" name="username" placeholder="administrator" />
            <Field label="Password" name="password" type="password" placeholder="Stored encrypted" />
            <Field label="Domain" name="domain" placeholder="Optional" />
            <label>
              Folder
              <select name="folderId" defaultValue="">
                <option value="">Unfiled</option>
                {credentialFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>Tags<TagPicker tags={data.tags} type="credential" /></label>
            <label>Private key<textarea name="privateKey" rows={3} placeholder="Optional SSH private key" /></label>
            <Field label="Passphrase" name="passphrase" type="password" placeholder="Optional" />
            <label>Notes<textarea name="notes" rows={2} /></label>
            <button className="primary-button" type="submit" disabled={submitting}><KeyRound size={16} /> Add credential</button>
          </form>
        ) : null}

        {activeTab === "check" ? (
          <form key={editCheck?.id ?? "new-check"} className="tool-panel" onSubmit={submitCheck}>
            <h3>{editCheck ? <><Pencil size={15} /> Edit check</> : "Health Check"}</h3>
            {editCheck ? <p className="muted-copy" style={{ margin: 0 }}>Editing <strong>{editCheck.target}</strong></p> : null}
            <label>
              Resource
              <select name="resourceId" required defaultValue={editCheck?.resourceId ?? ""}>
                <option value="">Select resource</option>
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
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary-button" type="submit" disabled={submitting}><Activity size={16} /> {editCheck ? "Update" : "Add"}</button>
              {editCheck ? <button className="icon-button" type="button" title="Cancel" onClick={cancelEdit}><X size={16} /></button> : null}
            </div>
          </form>
        ) : null}

        {activeTab === "notes" ? (
          <form className="tool-panel" onSubmit={submitNote}>
            <h3>{editNote ? "Edit note" : "New note"}</h3>
            <label>
              Title
              <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required placeholder="Note title" />
            </label>
            <label>
              Resource
              <select value={noteResourceId} onChange={(e) => setNoteResourceId(e.target.value)}>
                <option value="">No linked resource</option>
                {data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
              </select>
            </label>
            <label>
              Body
              <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={4} required placeholder="Note content…" />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> {editNote ? "Update note" : "Add note"}</button>
              {editNote ? (
                <button className="icon-text-button" type="button" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }} onClick={() => { setEditNote(null); setNoteTitle(""); setNoteBody(""); setNoteResourceId(""); }}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        {activeTab === "tags" ? (
          <form className="tool-panel" onSubmit={submitTag}>
            <h3><Tag size={15} /> Create tag</h3>
            <Field label="Name" name="name" required />
            <Field label="Color" name="color" type="color" defaultValue="#2dd4bf" />
            <label>
              Type
              <select name="type" defaultValue="general">
                <option value="general">General</option>
                <option value="resource">Resource</option>
                <option value="connection">Connection</option>
                <option value="credential">Credential</option>
              </select>
            </label>
            <button className="primary-button" type="submit" disabled={submitting}><Plus size={16} /> Add tag</button>
            <div className="row-list" style={{ marginTop: 12 }}>
              {data.tags.map((tag) => (
                <div className="data-row" key={tag.id}>
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
          </form>
        ) : null}
      </div>

      <div className="inventory-tables">
        <section className="table-panel">
          <h3>Resources</h3>
          <div className="row-list">
            {data.resources.map((resource, index, list) => (
              <div className="data-row data-row-wide" key={resource.id}>
                <span>
                  <strong>{resource.name}</strong>
                  <small>{resource.kind}{resource.url ? ` · ${resource.url}` : ""}{resource.host ? ` · ${resource.host}` : ""}</small>
                </span>
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
                No resources saved yet. <button className="link-button" type="button" onClick={() => onTabChange("resource")}>Add one</button>
              </p>
            ) : null}
          </div>
        </section>

        <section className="table-panel">
          <h3>Connections</h3>
          <div className="row-list">
            {data.connections.map((connection) => (
              <div className="data-row data-row-wide" key={connection.id}>
                <span>
                  <strong>{connection.name ?? connection.resource?.name ?? connection.host}</strong>
                  <small>{connection.type.toUpperCase()} · {connection.host}:{connection.port}{connection.credential ? ` · ${connection.credential.label}` : ""}</small>
                </span>
                <button className="icon-button" type="button" title="Edit" onClick={() => startEditConnection(connection)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/connections/${connection.id}`, connection.name ?? connection.host)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.connections.length === 0 ? (
              <p className="muted-copy">
                No remote access records. <button className="link-button" type="button" onClick={() => onTabChange("connection")}>Add connection</button>
              </p>
            ) : null}
          </div>
        </section>

        <section className="table-panel">
          <h3>Credentials</h3>
          <div className="row-list">
            {data.credentials.map((credential) => (
              <div className="data-row data-row-wide" key={credential.id}>
                <span>
                  <strong>{credential.label}</strong>
                  <small>
                    {credential.username ?? "No username"}
                    {credential.folderId ? ` · ${credentialFolders.find((f) => f.id === credential.folderId)?.name ?? "Folder"}` : " · Unfiled"}
                  </small>
                </span>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/credentials/${credential.id}`, credential.label)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.credentials.length === 0 ? (
              <p className="muted-copy">
                No credentials saved yet. <button className="link-button" type="button" onClick={() => onTabChange("credential")}>Add credential</button>
              </p>
            ) : null}
          </div>
        </section>

        <section className="table-panel">
          <h3>Health Checks</h3>
          <div className="row-list">
            {data.checks.map((check) => (
              <div className="data-row data-row-wide" key={check.id}>
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
      </div>

      <section className="table-panel" style={{ marginTop: 18 }}>
        <div className="section-heading">
          <h3>Notes</h3>
          <button className="icon-text-button" type="button" onClick={() => onTabChange("notes")}>
            <Plus size={14} /> Add note
          </button>
        </div>
        <div className="row-list">
          {data.notes.map((note) => (
            <div className="data-row data-row-wide" key={note.id}>
              <span>
                <strong>{note.title}{note.pinned ? " 📌" : ""}</strong>
                <small>
                  {note.resourceId ? `${data.resources.find((resource) => resource.id === note.resourceId)?.name ?? "Resource"} · ` : ""}
                  {note.body.slice(0, 80)}{note.body.length > 80 ? "…" : ""} · {formatDateTime(note.updatedAt)}
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
              No notes yet. <button className="link-button" type="button" onClick={() => onTabChange("notes")}>Create one</button>
            </p>
          ) : null}
        </div>
      </section>
      </>
      )}
    </main>
  );
}
