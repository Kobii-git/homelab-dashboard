import { Activity, Database, KeyRound, Plus, Save, Server, TerminalSquare, Trash2 } from "lucide-react";
import { FormEvent } from "react";
import { CONNECTION_TYPES, HEALTH_CHECK_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { MetricCard, StatusBadge } from "../../components/Primitives";
import { apiSend, emptyToNull } from "../../lib/api";
import type { V2Data } from "../types";

function Field({
  label,
  name,
  type = "text",
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input name={name} type={type} placeholder={placeholder} />
    </label>
  );
}

export function InventoryView({ data, onRefresh }: { data: V2Data; onRefresh: () => Promise<void> }) {
  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiSend("/api/groups", "POST", { name: emptyToNull(form.get("name")) });
    formElement.reset();
    await onRefresh();
  }

  async function submitResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiSend("/api/resources", "POST", {
      name: emptyToNull(form.get("name")),
      kind: form.get("kind"),
      url: emptyToNull(form.get("url")),
      host: emptyToNull(form.get("host")),
      icon: emptyToNull(form.get("icon")),
      color: emptyToNull(form.get("color")),
      description: emptyToNull(form.get("description")),
      notes: emptyToNull(form.get("notes")),
      groupId: emptyToNull(form.get("groupId")),
      favorite: form.get("favorite") === "on"
    });
    formElement.reset();
    await onRefresh();
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiSend("/api/credentials", "POST", {
      label: emptyToNull(form.get("label")),
      username: emptyToNull(form.get("username")),
      notes: emptyToNull(form.get("notes")),
      folderId: emptyToNull(form.get("folderId")),
      password: emptyToNull(form.get("password")),
      domain: emptyToNull(form.get("domain")),
      privateKey: emptyToNull(form.get("privateKey")),
      passphrase: emptyToNull(form.get("passphrase"))
    });
    formElement.reset();
    await onRefresh();
  }

  async function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const type = String(form.get("type"));
    await apiSend("/api/connections", "POST", {
      resourceId: form.get("resourceId"),
      type,
      name: emptyToNull(form.get("name")),
      host: emptyToNull(form.get("host")),
      port: Number(form.get("port") || (type === "ssh" ? 22 : 3389)),
      usernameHint: emptyToNull(form.get("usernameHint")),
      credentialId: emptyToNull(form.get("credentialId")),
      folderId: emptyToNull(form.get("folderId")),
      notes: emptyToNull(form.get("notes")),
      favorite: form.get("favorite") === "on"
    });
    formElement.reset();
    await onRefresh();
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await apiSend("/api/health-checks", "POST", {
      resourceId: form.get("resourceId"),
      type: form.get("type"),
      target: emptyToNull(form.get("target")),
      intervalSeconds: Number(form.get("intervalSeconds") || 60),
      timeoutMs: Number(form.get("timeoutMs") || 3000),
      failureThreshold: Number(form.get("failureThreshold") || 1),
      successThreshold: Number(form.get("successThreshold") || 1),
      enabled: true
    });
    formElement.reset();
    await onRefresh();
  }

  async function remove(path: string) {
    await apiSend(path, "DELETE");
    await onRefresh();
  }

  const credentialFolders = data.folders.filter((folder) => folder.type === "credential" || folder.type === "mixed");
  const connectionFolders = data.folders.filter((folder) => folder.type === "connection" || folder.type === "mixed");

  return (
    <main className="view-shell">
      <header className="view-header">
        <div>
          <h2>Inventory</h2>
          <span>
            {data.resources.length} resources · {data.connections.length} connections · {data.checks.length} checks
          </span>
        </div>
      </header>
      <section className="dashboard-overview">
        <MetricCard icon={<Server size={18} />} label="Resources" value={data.resources.length} tone="accent" />
        <MetricCard icon={<TerminalSquare size={18} />} label="Remote entries" value={data.connections.length} />
        <MetricCard icon={<Activity size={18} />} label="Health checks" value={data.checks.length} />
        <MetricCard icon={<KeyRound size={18} />} label="Vault items" value={data.credentials.length} />
        <MetricCard icon={<Database size={18} />} label="Groups" value={data.groups.length} />
      </section>

      <div className="inventory-grid">
        <form className="tool-panel" onSubmit={submitGroup}>
          <h3>Group</h3>
          <Field label="Name" name="name" />
          <button className="primary-button" type="submit">
            <Plus size={16} />
            Add
          </button>
        </form>

        <form className="tool-panel" onSubmit={submitResource}>
          <h3>Resource</h3>
          <Field label="Name" name="name" />
          <label>
            Kind
            <select name="kind" defaultValue="app">
              {RESOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <Field label="URL" name="url" placeholder="https://service.local" />
          <Field label="Host" name="host" placeholder="192.168.1.10" />
          <Field label="Icon label" name="icon" />
          <Field label="Color" name="color" placeholder="#2dd4bf" />
          <label>
            Group
            <select name="groupId" defaultValue="">
              <option value="">Ungrouped</option>
              {data.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea name="description" rows={3} />
          </label>
          <label>
            Notes
            <textarea name="notes" rows={3} />
          </label>
          <label className="checkbox-row">
            <input name="favorite" type="checkbox" />
            Favorite
          </label>
          <button className="primary-button" type="submit">
            <Save size={16} />
            Save
          </button>
        </form>

        <form className="tool-panel" onSubmit={submitCredential}>
          <h3>Credential</h3>
          <Field label="Label" name="label" />
          <Field label="Username" name="username" />
          <label>
            Folder
            <select name="folderId" defaultValue="">
              <option value="">Unfiled</option>
              {credentialFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Password" name="password" type="password" />
          <Field label="Domain" name="domain" />
          <label>
            Private key
            <textarea name="privateKey" rows={4} />
          </label>
          <Field label="Passphrase" name="passphrase" type="password" />
          <label>
            Notes
            <textarea name="notes" rows={3} />
          </label>
          <button className="primary-button" type="submit">
            <KeyRound size={16} />
            Save
          </button>
        </form>

        <form className="tool-panel" onSubmit={submitConnection}>
          <h3>Connection</h3>
          <label>
            Resource
            <select name="resourceId" required>
              <option value="">Select</option>
              {data.resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="type" defaultValue="rdp">
              {CONNECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <Field label="Name" name="name" />
          <Field label="Host" name="host" />
          <Field label="Port" name="port" type="number" placeholder="3389" />
          <Field label="Username hint" name="usernameHint" />
          <label>
            Folder
            <select name="folderId" defaultValue="">
              <option value="">Unfiled</option>
              {connectionFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Credential
            <select name="credentialId" defaultValue="">
              <option value="">Prompt or anonymous</option>
              {data.credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea name="notes" rows={3} />
          </label>
          <label className="checkbox-row">
            <input name="favorite" type="checkbox" />
            Favorite
          </label>
          <button className="primary-button" type="submit">
            <Plus size={16} />
            Add
          </button>
        </form>

        <form className="tool-panel" onSubmit={submitCheck}>
          <h3>Health Check</h3>
          <label>
            Resource
            <select name="resourceId" required>
              <option value="">Select</option>
              {data.resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="type" defaultValue="http">
              {HEALTH_CHECK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <Field label="Target" name="target" placeholder="https://service.local" />
          <Field label="Interval seconds" name="intervalSeconds" type="number" placeholder="60" />
          <Field label="Timeout ms" name="timeoutMs" type="number" placeholder="3000" />
          <Field label="Failure threshold" name="failureThreshold" type="number" placeholder="1" />
          <Field label="Recovery threshold" name="successThreshold" type="number" placeholder="1" />
          <button className="primary-button" type="submit">
            <Activity size={16} />
            Add
          </button>
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
                  <small>{resource.kind}</small>
                </span>
                <button className="icon-button danger" type="button" onClick={() => remove(`/api/resources/${resource.id}`)}>
                  <Trash2 size={16} />
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
                  <small>
                    {connection.type.toUpperCase()} · {connection.host}:{connection.port}
                  </small>
                </span>
                <button className="icon-button danger" type="button" onClick={() => remove(`/api/connections/${connection.id}`)}>
                  <Trash2 size={16} />
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
                  <small>
                    {check.type} · {check.target}
                  </small>
                </span>
                <StatusBadge status={check.latestStatus} />
                <button className="icon-button danger" type="button" onClick={() => remove(`/api/health-checks/${check.id}`)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {data.checks.length === 0 ? <p className="muted-copy">No checks configured.</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
