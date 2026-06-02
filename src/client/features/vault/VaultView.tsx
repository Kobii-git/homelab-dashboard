import { AlertTriangle, Clipboard, Eye, FolderPlus, KeyRound, Plus, Shield, Tag } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { EmptyPanel, MetricCard } from "../../components/Primitives";
import type { CredentialDto } from "../../lib/api";
import { apiSend, emptyToNull } from "../../lib/api";
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
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const selected = useMemo(
    () => data.credentials.find((credential) => credential.id === selectedId) ?? data.credentials[0] ?? null,
    [data.credentials, selectedId]
  );
  const unusedCount = data.credentials.filter((credential) => !credential.lastUsedAt).length;
  const orphanedCount = data.credentials.filter(
    (credential) => !data.connections.some((connection) => connection.credentialId === credential.id)
  ).length;

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await apiSend("/api/vault/folders", "POST", {
      name: emptyToNull(form.get("name")),
      type: "credential"
    });
    event.currentTarget.reset();
    await onRefresh();
  }

  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    const secret = await apiSend<RevealedSecret>("/api/vault/reveal", "POST", {
      credentialId: selected.id,
      password
    });
    setRevealed(secret);
    setPassword("");
    await onRefresh();
  }

  async function copy(value: string | null | undefined) {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
  }

  return (
    <main className="view-shell vault-shell">
      <header className="view-header">
        <div>
          <h2>Vault</h2>
          <span>{data.credentials.length} credentials · {data.audit.length} audit events</span>
        </div>
      </header>
      <section className="dashboard-overview">
        <MetricCard icon={<KeyRound size={18} />} label="Credentials" value={data.credentials.length} tone="accent" />
        <MetricCard icon={<FolderPlus size={18} />} label="Folders" value={data.folders.length} />
        <MetricCard icon={<Tag size={18} />} label="Tags" value={data.tags.length} />
        <MetricCard icon={<AlertTriangle size={18} />} label="Unused" value={unusedCount} />
        <MetricCard icon={<Shield size={18} />} label="Orphaned" value={orphanedCount} tone={orphanedCount ? "offline" : "online"} />
      </section>

      <section className="split-grid vault-grid">
        <aside className="table-panel">
          <h3>Credentials</h3>
          <div className="row-list">
            {data.credentials.map((credential) => (
              <button
                className={`vault-row ${selected?.id === credential.id ? "active" : ""}`}
                type="button"
                key={credential.id}
                onClick={() => {
                  setSelectedId(credential.id);
                  setRevealed(null);
                  onInspectCredential(credential);
                }}
              >
                <KeyRound size={16} />
                <span>
                  <strong>{credential.label}</strong>
                  <small>{credential.username ?? "No username"} · Last used {formatDateTime(credential.lastUsedAt)}</small>
                </span>
              </button>
            ))}
            {data.credentials.length === 0 ? (
              <EmptyPanel icon={<KeyRound size={34} />} title="No credentials" body="Create credentials in Inventory." />
            ) : null}
          </div>
        </aside>

        <section className="table-panel vault-detail">
          <h3>{selected?.label ?? "No credential selected"}</h3>
          {selected ? (
            <>
              <div className="key-value-grid">
                <span>Username</span>
                <strong>{selected.username ?? "-"}</strong>
                <span>Folder</span>
                <strong>{data.folders.find((folder) => folder.id === selected.folderId)?.name ?? "Unfiled"}</strong>
                <span>Last used</span>
                <strong>{formatDateTime(selected.lastUsedAt)}</strong>
              </div>
              <form className="inline-form" onSubmit={reveal}>
                <label>
                  Re-auth password
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <button className="primary-button" type="submit">
                  <Eye size={16} />
                  Reveal
                </button>
              </form>
              {revealed ? (
                <div className="secret-panel">
                  <div className="secret-row">
                    <span>Password</span>
                    <code>{revealed.password ?? "-"}</code>
                    <button className="icon-button" type="button" onClick={() => copy(revealed.password)}>
                      <Clipboard size={15} />
                    </button>
                  </div>
                  <div className="secret-row">
                    <span>Domain</span>
                    <code>{revealed.domain ?? "-"}</code>
                  </div>
                  {revealed.privateKey ? (
                    <div className="secret-row stacked">
                      <span>Private key</span>
                      <pre>{revealed.privateKey}</pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="table-panel">
          <h3>Folders</h3>
          <form className="inline-form" onSubmit={createFolder}>
            <label>
              Name
              <input name="name" />
            </label>
            <button className="primary-button" type="submit">
              <Plus size={16} />
              Add folder
            </button>
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
        <h3>Audit</h3>
        <div className="timeline-list">
          {data.audit.slice(0, 20).map((event) => (
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
