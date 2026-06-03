import { History, Maximize2, Monitor, Play, Plus, RefreshCw, RotateCcw, Save, Search, Server, TerminalSquare, Wifi, WifiOff, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CONNECTION_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { GuacamoleDisplay } from "../../components/GuacamoleDisplay";
import type { ConnectionDto, SessionLaunchDto } from "../../lib/api";
import { apiSend, apiGet, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";
import type { DashboardResource } from "../../../shared/types";

type RemoteTab = {
  id: string;
  connectionId: string;
  title: string;
  state: "launching" | "connected" | "failed" | "closed";
  fullscreen: boolean;
  startedAt: string;
  session?: SessionLaunchDto;
  error?: string;
};

function connectionTitle(connection: ConnectionDto): string {
  return connection.name ?? connection.resource?.name ?? connection.host;
}

export function AccessManager({
  data,
  onRefresh,
  launchConnectionId,
  onLaunchHandled
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  launchConnectionId?: string | null;
  onLaunchHandled?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickProtocol, setQuickProtocol] = useState<"ssh" | "rdp">("ssh");
  const [tabs, setTabs] = useState<RemoteTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guacdReachable, setGuacdReachable] = useState<boolean | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const folders = data.folders.filter((folder) => folder.type === "connection" || folder.type === "mixed");

  useEffect(() => {
    void apiGet<{ guacd: { reachable: boolean } }>("/api/health").then((health) => {
      setGuacdReachable(health.guacd.reachable);
    }).catch(() => setGuacdReachable(false));
  }, []);

  useEffect(() => {
    if (!launchConnectionId) return;
    const connection = data.connections.find((item) => item.id === launchConnectionId);
    onLaunchHandled?.();
    if (connection) {
      void launch(connection);
    }
  }, [launchConnectionId]);

  const filteredConnections = useMemo(
    () =>
      data.connections.filter((connection) => {
        const haystack = `${connection.name ?? ""} ${connection.resource?.name ?? ""} ${connection.host} ${connection.type}`;
        const matchesQuery = haystack.toLowerCase().includes(query.toLowerCase());
        const matchesFolder = !folderFilter || connection.folderId === folderFilter;
        return matchesQuery && matchesFolder;
      }),
    [data.connections, query, folderFilter]
  );

  async function launch(connection: ConnectionDto) {
    setLaunchingId(connection.id);
    const tempId = `pending-${connection.id}-${Date.now()}`;
    const pendingTab: RemoteTab = {
      id: tempId,
      connectionId: connection.id,
      title: connectionTitle(connection),
      state: "launching",
      fullscreen: false,
      startedAt: new Date().toISOString()
    };
    setTabs((current) => [...current, pendingTab]);
    setActiveTabId(tempId);

    try {
      const session = await apiSend<SessionLaunchDto>("/api/sessions", "POST", {
        connectionId: connection.id
      });
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tempId
            ? {
                ...tab,
                id: session.sessionHistory?.id ?? tempId,
                state: "connected",
                session
              }
            : tab
        )
      );
      setActiveTabId(session.sessionHistory?.id ?? tempId);
      await onRefresh();
    } catch (error) {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tempId
            ? {
                ...tab,
                state: "failed",
                error: error instanceof Error ? error.message : "Session failed"
              }
            : tab
        )
      );
    } finally {
      setLaunchingId(null);
    }
  }

  async function closeTab(tab: RemoteTab) {
    if (!tab.id.startsWith("pending-")) {
      await apiSend(`/api/sessions/history/${tab.id}`, "PATCH", {
        status: tab.state === "failed" ? "failed" : "closed",
        error: tab.error ?? null
      });
    }
    const nextTabs = tabs.filter((item) => item.id !== tab.id);
    setTabs(nextTabs);
    setActiveTabId(nextTabs[0]?.id ?? null);
    await onRefresh();
  }

  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const form = new FormData(event.currentTarget);
      const name = String(form.get("name") ?? "").trim();
      const host = String(form.get("host") ?? "").trim();
      const type = String(form.get("type") ?? quickProtocol) as "ssh" | "rdp";
      const port = Number(form.get("port") || (type === "ssh" ? 22 : 3389));

      const resource = await apiSend<DashboardResource>("/api/resources", "POST", {
        name,
        kind: form.get("kind"),
        host,
        url: emptyToNull(form.get("url")),
        description: emptyToNull(form.get("description")),
        favorite: form.get("favorite") === "on"
      });

      await apiSend<ConnectionDto>("/api/connections", "POST", {
        resourceId: resource.id,
        type,
        name: emptyToNull(form.get("connectionName")) ?? `${name} ${type.toUpperCase()}`,
        host,
        port,
        usernameHint: emptyToNull(form.get("usernameHint")),
        credentialId: emptyToNull(form.get("credentialId")),
        folderId: emptyToNull(form.get("folderId")) ?? folderFilter,
        favorite: true,
        notes: emptyToNull(form.get("notes"))
      });

      event.currentTarget.reset();
      setQuickProtocol("ssh");
      setShowQuickAdd(false);
      await onRefresh();
    }, setActionError, setSubmitting, "Device added");
  }

  return (
    <main className={`access-shell ${activeTab?.fullscreen ? "is-fullscreen" : ""}`}>
      <aside className="connection-rail">
        <div className="rail-header">
          <div>
            <h2>Access</h2>
            <span>{data.connections.length} remote endpoints</span>
            {guacdReachable === null ? null : (
              <span className={`guacd-status ${guacdReachable ? "online" : "offline"}`}>
                {guacdReachable ? <Wifi size={12} /> : <WifiOff size={12} />}
                guacd {guacdReachable ? "online" : "offline"}
              </span>
            )}
          </div>
          <button className={`icon-button ${showQuickAdd ? "is-active" : ""}`} type="button" title="Add device" onClick={() => setShowQuickAdd((value) => !value)}>
            <Plus size={15} />
          </button>
        </div>
        {actionError ? <p className="form-error quick-add-error">{actionError}</p> : null}
        {showQuickAdd ? (
          <form className="quick-add-panel" onSubmit={addDevice}>
            <div className="quick-add-title">
              <Server size={15} />
              <strong>Add device</strong>
            </div>
            <label>
              Name
              <input name="name" required placeholder="Ubuntu host" />
            </label>
            <label>
              Host
              <input name="host" required placeholder="192.168.1.20" />
            </label>
            <label>
              Kind
              <select name="kind" defaultValue="server">
                {RESOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <label>
              URL
              <input name="url" placeholder="Optional web console" />
            </label>
            <label>
              Protocol
              <select name="type" value={quickProtocol} onChange={(event) => setQuickProtocol(event.target.value as "ssh" | "rdp")}>
                {CONNECTION_TYPES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
              </select>
            </label>
            <label>
              Port
              <input name="port" type="number" min="1" max="65535" placeholder={quickProtocol === "ssh" ? "22" : "3389"} />
            </label>
            <label>
              Connection name
              <input name="connectionName" placeholder={`${quickProtocol.toUpperCase()} session`} />
            </label>
            <label>
              Username hint
              <input name="usernameHint" placeholder={quickProtocol === "ssh" ? "root" : "DOMAIN\\admin"} />
            </label>
            <label>
              Credential
              <select name="credentialId" defaultValue="">
                <option value="">Prompt or anonymous</option>
                {data.credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}
              </select>
            </label>
            <label>
              Folder
              <select name="folderId" defaultValue={folderFilter ?? ""}>
                <option value="">Unfiled</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <label>Description<textarea name="description" rows={2} /></label>
            <label>Notes<textarea name="notes" rows={2} /></label>
            <label className="checkbox-row">
              <input name="favorite" type="checkbox" defaultChecked />
              Favorite resource
            </label>
            <div className="quick-add-actions">
              <button className="primary-button" type="submit" disabled={submitting}><Save size={15} /> Save</button>
              <button className="icon-button" type="button" title="Cancel" onClick={() => setShowQuickAdd(false)}><X size={15} /></button>
            </div>
          </form>
        ) : null}
        <label className="rail-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find host" />
        </label>
        <div className="folder-strip">
          <span
            className={`folder-chip ${!folderFilter ? "active" : ""}`}
            onClick={() => setFolderFilter(null)}
          >
            All
          </span>
          {folders.map((folder) => (
            <span
              key={folder.id}
              className={`folder-chip ${folderFilter === folder.id ? "active" : ""}`}
              onClick={() => setFolderFilter(folderFilter === folder.id ? null : folder.id)}
            >
              {folder.name}
            </span>
          ))}
        </div>
        <div className="connection-list">
          {filteredConnections.map((connection) => (
            <button
              className="connection-row"
              type="button"
              key={connection.id}
              onDoubleClick={() => launch(connection)}
              onClick={() => launch(connection)}
            >
              {connection.type === "ssh" ? <TerminalSquare size={18} /> : <Monitor size={18} />}
              <span>
                <strong>{connectionTitle(connection)}</strong>
                <small>
                  {connection.type.toUpperCase()} · {connection.host}:{connection.port}
                  {connection.credential ? ` · ${connection.credential.label}` : ""}
                </small>
              </span>
              {launchingId === connection.id ? <RefreshCw className="spin" size={15} /> : <Play size={15} />}
            </button>
          ))}
          {data.connections.length === 0 ? (
            <div className="rail-empty">
              <TerminalSquare size={26} />
              <strong>No remote sessions</strong>
              <span>Add SSH or RDP connections in Inventory.</span>
              <button className="icon-text-button" type="button" onClick={() => setShowQuickAdd(true)}>
                <Plus size={14} /> Add device
              </button>
            </div>
          ) : null}
        </div>
        {data.sessionHistory.length > 0 ? (
          <div className="session-recents">
            <p className="recents-label"><History size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Recent Sessions</p>
            {data.sessionHistory.slice(0, 5).map((session) => (
              <div className="recent-session-row" key={session.id}>
                {session.protocol === "ssh" ? <TerminalSquare size={13} /> : <Monitor size={13} />}
                <span>
                  <strong>{session.resourceName}</strong>
                  <small>{session.protocol.toUpperCase()} · {formatDateTime(session.startedAt)}</small>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </aside>
      <section className="remote-window">
        <div className="session-tabs">
          {tabs.map((tab) => (
            <button
              className={`session-tab ${tab.id === activeTab?.id ? "active" : ""}`}
              type="button"
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.title}</span>
              <small>{tab.state}</small>
              <X
                size={14}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab);
                }}
              />
            </button>
          ))}
          {activeTab ? (
            <button
              className="icon-button"
              type="button"
              title="Toggle fullscreen"
              onClick={() =>
                setTabs((current) =>
                  current.map((tab) =>
                    tab.id === activeTab.id ? { ...tab, fullscreen: !tab.fullscreen } : tab
                  )
                )
              }
            >
              <Maximize2 size={15} />
            </button>
          ) : null}
        </div>
        {activeTab?.session ? (
          <GuacamoleDisplay websocketPath={activeTab.session.websocketPath} displayName={activeTab.title} />
        ) : activeTab ? (
          <div className="empty-state">
            <TerminalSquare size={42} />
            <h2>{activeTab.state}</h2>
            <p>{activeTab.error ?? `Started ${formatDateTime(activeTab.startedAt)}`}</p>
            {activeTab.state === "failed" ? (
              <button
                className="icon-text-button"
                type="button"
                onClick={() => {
                  const connection = data.connections.find((item) => item.id === activeTab.connectionId);
                  if (connection) void launch(connection);
                }}
              >
                <RotateCcw size={15} /> Retry
              </button>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">
            <Monitor size={42} />
            <h2>No session</h2>
            <p>Select a host on the left to start an embedded SSH or RDP session.</p>
          </div>
        )}
      </section>
    </main>
  );
}
