import { AlertTriangle, Clipboard, Eye, EyeOff, FolderPlus, KeyRound, Plus, Save, Search, Shield, Tag, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmptyPanel, MetricCard } from "../../components/Primitives";
import type { CredentialDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";

type RevealedSecret = {
  id: string;
  label: string;
  username: string | null;
  password: string | null;
  domain: string | null;
  privateKey: string | null;
  passphrase: string | null;
  expiresInSeconds: number;
};

export function VaultView({
  data,
  onRefresh,
  onInspectCredential
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  onInspectCredential: (credential: CredentialDto) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(data.credentials[0]?.id ?? null);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [credSearch, setCredSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const editFormRef = useRef<HTMLFormElement>(null);

  const selected = useMemo(
    () => data.credentials.find((c) => c.id === selectedId) ?? data.credentials[0] ?? null,
    [data.credentials, selectedId]
  );
  const editing = useMemo(
    () => (editingId ? data.credentials.find((c) => c.id === editingId) ?? null : null),
    [data.credentials, editingId]
  );

  const orphanIds = useMemo(
    () => new Set(data.credentials
      .filter((c) => !data.connections.some((conn) => conn.credentialId === c.id))
      .map((c) => c.id)),
    [data.credentials, data.connections]
  );

  const filteredCredentials = useMemo(() => {
    const q = credSearch.toLowerCase();
    if (!q) return data.credentials;
    return data.credentials.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.username?.toLowerCase().includes(q))
    );
  }, [data.credentials, credSearch]);

  const unusedCount = data.credentials.filter((c) => !c.lastUsedAt).length;
  const orphanedCount = orphanIds.size;

  // Auto-clear revealed secret after 30s
  useEffect(() => {
    if (!revealed) { setSecondsLeft(null); return undefined; }
    setSecondsLeft(30);
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1) { setRevealed(null); return null; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [revealed]);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const form = new FormData(event.currentTarget);
      await apiSend("/api/vault/folders", "POST", { name: emptyToNull(form.get("name")), type: "credential" });
      event.currentTarget.reset();
      await onRefresh();
    }, setActionError, setSubmitting, "Folder created");
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const form = new FormData(event.currentTarget);
      await apiSend("/api/credentials", "POST", {
        label: emptyToNull(form.get("label")),
        username: emptyToNull(form.get("username")),
        password: emptyToNull(form.get("password")),
        domain: emptyToNull(form.get("domain")),
        privateKey: emptyToNull(form.get("privateKey")),
        passphrase: emptyToNull(form.get("passphrase")),
        notes: emptyToNull(form.get("notes")),
        folderId: emptyToNull(form.get("folderId"))
      });
      event.currentTarget.reset();
      await onRefresh();
    }, setActionError, setSubmitting, "Credential added");
  }

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    await runFormAction(async () => {
      const secret = await apiSend<RevealedSecret>("/api/vault/reveal", "POST", {
        credentialId: selected.id,
        password: revealPassword
      });
      setRevealed(secret);
      setRevealPassword("");
      await onRefresh();
    }, setActionError, setSubmitting);
  }

  async function deleteCredential(credential: CredentialDto) {
    if (!window.confirm(`Delete credential "${credential.label}"? This cannot be undone.`)) return;
    await runFormAction(async () => {
      await apiSend(`/api/credentials/${credential.id}`, "DELETE");
      if (selectedId === credential.id) setSelectedId(null);
      if (editingId === credential.id) setEditingId(null);
      setRevealed(null);
      await onRefresh();
    }, setActionError, setSubmitting);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    await runFormAction(async () => {
      const form = new FormData(event.currentTarget);
      const body: Record<string, unknown> = {
        label: emptyToNull(form.get("label")),
        username: emptyToNull(form.get("username")),
        notes: emptyToNull(form.get("notes")),
        folderId: emptyToNull(form.get("folderId"))
      };
      const password = String(form.get("password") ?? "");
      if (password) {
        body.password = password;
        body.domain = emptyToNull(form.get("domain"));
        body.privateKey = emptyToNull(form.get("privateKey"));
        body.passphrase = emptyToNull(form.get("passphrase"));
      }
      await apiSend(`/api/credentials/${editingId}`, "PATCH", body);
      setEditingId(null);
      await onRefresh();
    }, setActionError, setSubmitting);
  }

  async function copy(value: string | null | undefined) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  const credentialFolders = data.folders.filter((f) => f.type === "credential" || f.type === "mixed");

  return (
    <main className="view-shell vault-shell">
      <header className="view-header">
        <div>
          <h2>Vault</h2>
          <span>{data.credentials.length} credentials · {data.audit.length} audit events</span>
        </div>
      </header>

      <FormErrorBanner message={actionError} />

      <section className="dashboard-overview">
        <MetricCard icon={<KeyRound size={18} />} label="Credentials" value={data.credentials.length} tone="accent" />
        <MetricCard icon={<FolderPlus size={18} />} label="Folders" value={data.folders.length} />
        <MetricCard icon={<Tag size={18} />} label="Tags" value={data.tags.length} />
        <MetricCard icon={<AlertTriangle size={18} />} label="Unused" value={unusedCount} />
        <MetricCard icon={<Shield size={18} />} label="Orphaned" value={orphanedCount} tone={orphanedCount ? "offline" : "online"} />
      </section>

      <section className="split-grid vault-grid">
        <aside className="table-panel">
          <div className="section-heading" style={{ marginBottom: 10 }}>
            <h3>Credentials</h3>
          </div>
          <label className="search-box" style={{ width: "100%", marginBottom: 10 }}>
            <Search size={14} />
            <input value={credSearch} onChange={(e) => setCredSearch(e.target.value)} placeholder="Filter credentials" />
          </label>
          <div className="row-list">
            {filteredCredentials.map((credential) => (
              <div key={credential.id} className={`vault-row-wrap ${selected?.id === credential.id ? "active" : ""}`}>
                <button
                  className={`vault-row ${selected?.id === credential.id ? "active" : ""}`}
                  type="button"
                  onClick={() => { setSelectedId(credential.id); setRevealed(null); setEditingId(null); onInspectCredential(credential); }}
                >
                  <KeyRound size={16} />
                  <span>
                    <strong>
                      {credential.label}
                      {orphanIds.has(credential.id) ? <span className="orphan-tag" title="No connection uses this credential"> orphaned</span> : null}
                    </strong>
                    <small>{credential.username ?? "No username"} · {formatDateTime(credential.lastUsedAt)}</small>
                  </span>
                  <span />
                </button>
                <div className="vault-row-actions">
                  <button className="icon-button" type="button" title="Edit" onClick={() => { setEditingId(editingId === credential.id ? null : credential.id); setSelectedId(credential.id); setRevealed(null); }}>
                    <Save size={13} />
                  </button>
                  <button className="icon-button danger" type="button" title="Delete" onClick={() => deleteCredential(credential)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {filteredCredentials.length === 0 ? (
              <EmptyPanel icon={<KeyRound size={34} />} title={credSearch ? "No match" : "No credentials"} body={credSearch ? "Try a different search." : "Create credentials in Inventory."} />
            ) : null}
          </div>
        </aside>

        <section className="table-panel vault-detail">
          {editing ? (
            <>
              <h3>Edit — {editing.label}</h3>
              <form ref={editFormRef} className="inline-form" onSubmit={saveEdit}>
                <label>Label<input name="label" defaultValue={editing.label} required /></label>
                <label>Username<input name="username" defaultValue={editing.username ?? ""} /></label>
                <label>
                  Folder
                  <select name="folderId" defaultValue={editing.folderId ?? ""}>
                    <option value="">Unfiled</option>
                    {credentialFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label>Notes<textarea name="notes" rows={2} defaultValue={editing.notes ?? ""} /></label>
                <p className="muted-copy" style={{ fontSize: 12, margin: 0 }}>
                  Leave password blank to keep existing secret.
                </p>
                <label>New password<input name="password" type="password" placeholder="Leave blank to keep" /></label>
                <label>Domain<input name="domain" placeholder="Optional" /></label>
                <label>Private key<textarea name="privateKey" rows={3} placeholder="Leave blank to keep" /></label>
                <label>Passphrase<input name="passphrase" type="password" placeholder="Leave blank to keep" /></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="primary-button" type="submit"><Save size={15} /> Save</button>
                  <button className="icon-text-button" type="button" style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }} onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </form>
            </>
          ) : (
            <>
              <h3>{selected?.label ?? "No credential selected"}</h3>
              {selected ? (
                <>
                  <div className="key-value-grid">
                    <span><span>Username</span><strong>{selected.username ?? "-"}</strong></span>
                    <span><span>Folder</span><strong>{data.folders.find((f) => f.id === selected.folderId)?.name ?? "Unfiled"}</strong></span>
                    <span><span>Last used</span><strong>{formatDateTime(selected.lastUsedAt)}</strong></span>
                  </div>
                  <form className="inline-form" onSubmit={reveal}>
                    <label>
                      Re-auth password
                      <input type="password" value={revealPassword} onChange={(e) => setRevealPassword(e.target.value)} />
                    </label>
                    <button className="primary-button" type="submit">
                      <Eye size={16} />
                      Reveal secrets
                    </button>
                  </form>
                  {revealed ? (
                    <div className="secret-panel">
                      <div className="secret-countdown">
                        <EyeOff size={13} />
                        Auto-clears in {secondsLeft}s
                        <button type="button" className="icon-button" style={{ marginLeft: "auto" }} title="Clear now" onClick={() => setRevealed(null)}>
                          <EyeOff size={13} />
                        </button>
                      </div>
                      <div className="secret-row">
                        <span>Password</span>
                        <code>{revealed.password ?? "-"}</code>
                        <button className="icon-button" type="button" onClick={() => copy(revealed.password)}><Clipboard size={14} /></button>
                      </div>
                      <div className="secret-row">
                        <span>Domain</span>
                        <code>{revealed.domain ?? "-"}</code>
                        {revealed.domain ? <button className="icon-button" type="button" onClick={() => copy(revealed.domain)}><Clipboard size={14} /></button> : <span />}
                      </div>
                      {revealed.privateKey ? (
                        <div className="secret-row stacked">
                          <span>Private key</span>
                          <pre>{revealed.privateKey}</pre>
                          <button className="icon-button" type="button" style={{ justifySelf: "end" }} onClick={() => copy(revealed.privateKey)}><Clipboard size={14} /></button>
                        </div>
                      ) : null}
                      {revealed.passphrase ? (
                        <div className="secret-row">
                          <span>Passphrase</span>
                          <code>{revealed.passphrase}</code>
                          <button className="icon-button" type="button" onClick={() => copy(revealed.passphrase)}><Clipboard size={14} /></button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </section>

        <section className="table-panel">
          <h3>New credential</h3>
          <form className="inline-form" onSubmit={createCredential}>
            <label>Label<input name="label" required placeholder="Lab admin" /></label>
            <label>Username<input name="username" placeholder="administrator" /></label>
            <label>Password<input name="password" type="password" placeholder="Stored encrypted" /></label>
            <label>Domain<input name="domain" placeholder="Optional" /></label>
            <label>
              Folder
              <select name="folderId" defaultValue="">
                <option value="">Unfiled</option>
                {credentialFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label>Private key<textarea name="privateKey" rows={3} placeholder="Optional SSH private key" /></label>
            <label>Passphrase<input name="passphrase" type="password" placeholder="Optional" /></label>
            <label>Notes<textarea name="notes" rows={2} /></label>
            <button className="primary-button" type="submit" disabled={submitting}><Plus size={16} /> Add credential</button>
          </form>

          <div className="panel-divider" />

          <h3>Folders</h3>
          <form className="inline-form" onSubmit={createFolder}>
            <label>Name<input name="name" required /></label>
            <button className="primary-button" type="submit"><Plus size={16} /> Add folder</button>
          </form>
          <div className="row-list">
            {data.folders.map((folder) => (
              <div className="data-row" key={folder.id}>
                <span>
                  <strong>{folder.name}</strong>
                  <small>{folder.type}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="table-panel">
        <h3>Audit Log</h3>
        <div className="timeline-list">
          {data.audit.slice(0, 30).map((event) => (
            <div className="timeline-row" key={event.id}>
              <span>{formatDateTime(event.createdAt)}</span>
              <strong>{event.action}</strong>
              <p>{event.summary}</p>
            </div>
          ))}
          {data.audit.length === 0 ? <p className="muted-copy">No vault audit events yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
