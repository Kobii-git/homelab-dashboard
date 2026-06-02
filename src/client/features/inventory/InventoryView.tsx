import { Activity, Database, KeyRound, Pencil, Pin, Plus, Save, Server, TerminalSquare, Trash2, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { CONNECTION_TYPES, HEALTH_CHECK_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { MetricCard, StatusBadge } from "../../components/Primitives";
import type { HealthCheckDto, NoteDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";
import type { DashboardResource } from "../../../shared/types";
import type { ConnectionDto } from "../../lib/api";

type EditMode = "resource" | "connection" | "check" | null;

function Field({ label, name, type = "text", placeholder, defaultValue }: { label: string; name: string; type?: string; placeholder?: string; defaultValue?: string }) {
  return (
    <label>
      {label}
      <input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} />
    </label>
  );
}

export function InventoryView({ data, onRefresh }: { data: V2Data; onRefresh: () => Promise<void> }) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [editResource, setEditResource] = useState<DashboardResource | null>(null);
  const [editConnection, setEditConnection] = useState<ConnectionDto | null>(null);
  const [editCheck, setEditCheck] = useState<HealthCheckDto | null>(null);
  const [editNote, setEditNote] = useState<NoteDto | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  function startEditResource(r: DashboardResource) { setEditResource(r); setEditMode("resource"); setEditConnection(null); setEditCheck(null); }
  function startEditConnection(c: ConnectionDto) { setEditConnection(c); setEditMode("connection"); setEditResource(null); setEditCheck(null); }
  function startEditCheck(c: HealthCheckDto) { setEditCheck(c); setEditMode("check"); setEditResource(null); setEditConnection(null); }
  function cancelEdit() { setEditMode(null); setEditResource(null); setEditConnection(null); setEditCheck(null); }
  function startEditNote(note: NoteDto) { setEditNote(note); setNoteTitle(note.title); setNoteBody(note.body); }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await apiSend("/api/groups", "POST", { name: emptyToNull(f.get("name")) });
    event.currentTarget.reset();
    await onRefresh();
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      favorite: f.get("favorite") === "on"
    };
    if (editResource) {
      await apiSend(`/api/resources/${editResource.id}`, "PATCH", body);
      cancelEdit();
    } else {
      await apiSend("/api/resources", "POST", body);
      event.currentTarget.reset();
    }
    await onRefresh();
  }

  async function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const type = String(f.get("type"));
    const body = {
      resourceId: f.get("resourceId"),
      type,
      name: emptyToNull(f.get("name")),
      host: emptyToNull(f.get("host")),
      port: Number(f.get("port") || (type === "ssh" ? 22 : 3389)),
      usernameHint: emptyToNull(f.get("usernameHint")),
      credentialId: emptyToNull(f.get("credentialId")),
      folderId: emptyToNull(f.get("folderId")),
      notes: emptyToNull(f.get("notes")),
      favorite: f.get("favorite") === "on"
    };
    if (editConnection) {
      await apiSend(`/api/connections/${editConnection.id}`, "PATCH", body);
      cancelEdit();
    } else {
      await apiSend("/api/connections", "POST", body);
      event.currentTarget.reset();
    }
    await onRefresh();
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!noteTitle.trim() || !noteBody.trim()) return;
    if (editNote) {
      await apiSend(`/api/notes/${editNote.id}`, "PATCH", { title: noteTitle, body: noteBody });
      setEditNote(null);
    } else {
      await apiSend("/api/notes", "POST", { title: noteTitle, body: noteBody, pinned: false });
    }
    setNoteTitle("");
    setNoteBody("");
    await onRefresh();
  }

  async function remove(path: string, label: string) {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    await apiSend(path, "DELETE");
    await onRefresh();
  }

  async function toggleCheckEnabled(check: HealthCheckDto) {
    await apiSend(`/api/health-checks/${check.id}`, "PATCH", { enabled: !check.enabled });
    await onRefresh();
  }

  async function togglePin(note: NoteDto) {
    await apiSend(`/api/notes/${note.id}`, "PATCH", { pinned: !note.pinned });
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

      <section className="dashboard-overview">
        <MetricCard icon={<Server size={18} />} label="Resources" value={data.resources.length} tone="accent" />
        <MetricCard icon={<TerminalSquare size={18} />} label="Connections" value={data.connections.length} />
        <MetricCard icon={<Activity size={18} />} label="Checks" value={data.checks.length} />
        <MetricCard icon={<KeyRound size={18} />} label="Vault items" value={data.credentials.length} />
        <MetricCard icon={<Database size={18} />} label="Groups" value={data.groups.length} />
      </section>

      <div className="inventory-grid">
        <form className="tool-panel" onSubmit={submitGroup}>
          <h3>Group</h3>
          <Field label="Name" name="name" />
          <button className="primary-button" type="submit"><Plus size={16} /> Add</button>
        </form>

        <form key={editResource?.id ?? "new-resource"} className="tool-panel" onSubmit={submitResource}>
          <h3>{editResource ? <><Pencil size={15} /> Edit resource</> : "Resource"}</h3>
          {editResource ? <p className="muted-copy" style={{ margin: 0 }}>Editing <strong>{editResource.name}</strong></p> : null}
          <Field label="Name" name="name" defaultValue={editResource?.name} />
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
          <label>Description<textarea name="description" rows={2} defaultValue={editResource?.description ?? ""} /></label>
          <label>Notes<textarea name="notes" rows={2} defaultValue={editResource?.notes ?? ""} /></label>
          <label className="checkbox-row">
            <input name="favorite" type="checkbox" defaultChecked={editResource?.favorite} />
            Favorite
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary-button" type="submit"><Save size={16} /> {editResource ? "Update" : "Save"}</button>
            {editResource ? <button className="icon-button" type="button" title="Cancel" onClick={cancelEdit}><X size={16} /></button> : null}
          </div>
        </form>

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
          <Field label="Host" name="host" defaultValue={editConnection?.host} />
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
          <label>Notes<textarea name="notes" rows={2} defaultValue={editConnection?.notes ?? ""} /></label>
          <label className="checkbox-row">
            <input name="favorite" type="checkbox" defaultChecked={editConnection?.favorite} />
            Favorite
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary-button" type="submit"><Save size={16} /> {editConnection ? "Update" : "Add"}</button>
            {editConnection ? <button className="icon-button" type="button" title="Cancel" onClick={cancelEdit}><X size={16} /></button> : null}
          </div>
        </form>

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
              {HEALTH_CHECK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field label="Target" name="target" placeholder="https://service.local" defaultValue={editCheck?.target} />
          <Field label="Interval (seconds)" name="intervalSeconds" type="number" placeholder="60" defaultValue={editCheck?.intervalSeconds?.toString()} />
          <Field label="Timeout (ms)" name="timeoutMs" type="number" placeholder="3000" defaultValue={editCheck?.timeoutMs?.toString()} />
          <Field label="Failure threshold" name="failureThreshold" type="number" placeholder="1" defaultValue={editCheck?.failureThreshold?.toString()} />
          <Field label="Recovery threshold" name="successThreshold" type="number" placeholder="1" defaultValue={editCheck?.successThreshold?.toString()} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary-button" type="submit"><Activity size={16} /> {editCheck ? "Update" : "Add"}</button>
            {editCheck ? <button className="icon-button" type="button" title="Cancel" onClick={cancelEdit}><X size={16} /></button> : null}
          </div>
        </form>
      </div>

      <div className="inventory-tables">
        <section className="table-panel">
          <h3>Resources</h3>
          <div className="row-list">
            {data.resources.map((resource) => (
              <div className="data-row" key={resource.id}>
                <span>
                  <strong>{resource.name}</strong>
                  <small>{resource.kind}{resource.url ? ` · ${resource.url}` : ""}{resource.host ? ` · ${resource.host}` : ""}</small>
                </span>
                <button className="icon-button" type="button" title="Edit" onClick={() => startEditResource(resource)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" type="button" title="Delete" onClick={() => remove(`/api/resources/${resource.id}`, resource.name)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {data.resources.length === 0 ? <p className="muted-copy">No resources saved yet.</p> : null}
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
            {data.connections.length === 0 ? <p className="muted-copy">No remote access records.</p> : null}
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
          <span>{data.notes.length}</span>
        </div>
        <form className="inline-form" style={{ marginTop: 12, marginBottom: 18 }} onSubmit={submitNote}>
          <label>
            Title
            <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required placeholder="Note title" />
          </label>
          <label>
            Body
            <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={3} required placeholder="Note content…" />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary-button" type="submit"><Save size={15} /> {editNote ? "Update note" : "Add note"}</button>
            {editNote ? (
              <button className="icon-text-button" type="button" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }} onClick={() => { setEditNote(null); setNoteTitle(""); setNoteBody(""); }}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <div className="row-list">
          {data.notes.map((note) => (
            <div className="data-row data-row-wide" key={note.id}>
              <span>
                <strong>{note.title}{note.pinned ? " 📌" : ""}</strong>
                <small>{note.body.slice(0, 80)}{note.body.length > 80 ? "…" : ""} · {formatDateTime(note.updatedAt)}</small>
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
          {data.notes.length === 0 ? <p className="muted-copy">No notes yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
