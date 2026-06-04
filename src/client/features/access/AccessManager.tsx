import {
  ChevronDown,
  History,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CONNECTION_TYPES, RESOURCE_KINDS } from "../../../shared/types";
import { GuacamoleDisplay } from "../../components/GuacamoleDisplay";
import { AccessDeviceRail } from "./AccessDeviceRail";
import { ProtocolIcon, sessionStatusLabel, type Protocol } from "./accessUtils";
import type { RemoteTab } from "./useRemoteSessions";
import type { ConnectionDto, SessionHistoryDto, SessionLaunchDto } from "../../lib/api";
import { apiGet, apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormSubmit } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { DashboardResource } from "../../../shared/types";
import type { V2Data } from "../types";

export function AccessManager({
  data,
  onRefresh,
  tabs,
  setTabs,
  activeTabId,
  setActiveTabId,
  launchConnectionId,
  onLaunchHandled
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
  tabs: RemoteTab[];
  setTabs: Dispatch<SetStateAction<RemoteTab[]>>;
  activeTabId: string | null;
  setActiveTabId: (tabId: string | null) => void;
  launchConnectionId?: string | null;
  onLaunchHandled?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionDto | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guacdReachable, setGuacdReachable] = useState<boolean | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const launchHandledRef = useRef<string | null>(null);

  const folders = data.folders.filter((folder) => folder.type === "connection" || folder.type === "mixed");
  const allConnections = useMemo(() => data.connections, [data.connections]);

  const filteredDevices = useMemo(
    () =>
      allConnections
        .filter((connection) => {
          const haystack = `${connection.name ?? ""} ${connection.resource?.name ?? ""} ${connection.host} ${connection.type} ${connection.usernameHint ?? ""}`;
          return haystack.toLowerCase().includes(query.toLowerCase());
        })
        .sort((a, b) => {
          const typeOrder = a.type.localeCompare(b.type);
          if (typeOrder !== 0) return typeOrder;
          const fav = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
          if (fav !== 0) return fav;
          const aTime = a.lastLaunchedAt ? new Date(a.lastLaunchedAt).getTime() : 0;
          const bTime = b.lastLaunchedAt ? new Date(b.lastLaunchedAt).getTime() : 0;
          return bTime - aTime;
        }),
    [allConnections, query]
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const activeConnectionId = activeTab?.connectionId ?? null;
  const fullscreen = activeTab?.fullscreen ?? false;

  const sessionHistory = useMemo(
    () => [...data.sessionHistory].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))),
    [data.sessionHistory]
  );

  useEffect(() => {
    void refreshGuacd();
    const timer = window.setInterval(() => void refreshGuacd(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!launchConnectionId) {
      launchHandledRef.current = null;
      return;
    }
    if (launchHandledRef.current === launchConnectionId) {
      return;
    }

    const connection = data.connections.find((item) => item.id === launchConnectionId);
    if (!connection) {
      return;
    }

    launchHandledRef.current = launchConnectionId;
    onLaunchHandled?.();
    void selectConnection(connection);
  }, [launchConnectionId, data.connections]);

  async function refreshGuacd() {
    try {
      const health = await apiGet<{ guacd: { reachable: boolean } }>("/api/health");
      setGuacdReachable(health.guacd.reachable);
    } catch {
      setGuacdReachable(false);
    }
  }

  function connectionTitle(connection: ConnectionDto): string {
    return connection.name ?? connection.resource?.name ?? connection.host;
  }

  async function launch(connection: ConnectionDto) {
    const protocol = connection.type as Protocol;

    let reachable = guacdReachable;
    if (reachable !== true) {
      try {
        const health = await apiGet<{ guacd: { reachable: boolean } }>("/api/health");
        reachable = health.guacd.reachable;
        setGuacdReachable(reachable);
      } catch {
        reachable = false;
        setGuacdReachable(false);
      }
    }

    if (!reachable) {
      setActionError("guacd is offline — remote sessions cannot start until the tunnel service is reachable.");
      return;
    }

    const existing = tabs.find(
      (tab) => tab.connectionId === connection.id && tab.state === "connected" && tab.session
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const inFlight = tabs.find(
      (tab) => tab.connectionId === connection.id && tab.state === "launching" && tab.session
    );
    if (inFlight) {
      setActiveTabId(inFlight.id);
      return;
    }

    setLaunchingId(connection.id);

    const tempId = `pending-${connection.id}-${Date.now()}`;
    const pendingTab: RemoteTab = {
      id: tempId,
      connectionId: connection.id,
      protocol,
      title: connectionTitle(connection),
      state: "launching",
      fullscreen: false,
      startedAt: new Date().toISOString()
    };

    setTabs((current) => [
      ...current.filter((tab) => tab.connectionId !== connection.id),
      pendingTab
    ]);
    setActiveTabId(tempId);

    try {
      const session = await apiSend<SessionLaunchDto>("/api/sessions", "POST", {
        connectionId: connection.id
      });
      const sessionId = session.sessionHistory?.id ?? tempId;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tempId ? { ...tab, id: sessionId, state: "launching", session } : tab
        )
      );
      setActiveTabId(sessionId);
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

  function selectConnection(connection: ConnectionDto) {
    const existing = tabs.find((tab) => tab.connectionId === connection.id);
    if (existing) {
      setActiveTabId(existing.id);
      if (existing.state === "failed" || !existing.session) {
        void launch(connection);
      }
      return;
    }
    void launch(connection);
  }

  async function closeTab(tab: RemoteTab) {
    if (!tab.id.startsWith("pending-")) {
      await apiSend(`/api/sessions/history/${tab.id}`, "PATCH", {
        status: tab.state === "failed" ? "failed" : "closed",
        error: tab.error ?? null
      });
    }
    setTabs((current) => {
      const nextTabs = current.filter((item) => item.id !== tab.id);
      setActiveTabId(nextTabs[0]?.id ?? null);
      return nextTabs;
    });
    await onRefresh();
  }

  async function relaunchFromHistory(session: SessionHistoryDto) {
    if (!session.connectionId) return;
    const connection = data.connections.find((item) => item.id === session.connectionId);
    if (connection) await launch(connection);
  }

  function toggleFullscreen(tabId: string) {
    setTabs((current) =>
      current.map((tab) => (tab.id === tabId ? { ...tab, fullscreen: !tab.fullscreen } : tab))
    );
  }

  function closeEndedTabs() {
    const endedIds = new Set(
      tabs.filter((tab) => tab.state === "failed" || tab.state === "closed").map((tab) => tab.id)
    );
    if (endedIds.size === 0) return;
    setTabs((current) => {
      const next = current.filter((tab) => !endedIds.has(tab.id));
      if (activeTabId && endedIds.has(activeTabId)) {
        setActiveTabId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  async function addDevice(event: FormEvent<HTMLFormElement>) {
    await runFormSubmit(event, async (form) => {
      const protocol = String(form.get("protocol") ?? "ssh") as Protocol;
      const name = String(form.get("name") ?? "").trim();
      const host = String(form.get("host") ?? "").trim();
      const port = Number(form.get("port") || (protocol === "ssh" ? 22 : 3389));

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
        type: protocol,
        name: emptyToNull(form.get("connectionName")) ?? `${name} ${protocol.toUpperCase()}`,
        host,
        port,
        usernameHint: emptyToNull(form.get("usernameHint")),
        credentialId: emptyToNull(form.get("credentialId")),
        folderId: emptyToNull(form.get("folderId")),
        favorite: true,
        notes: emptyToNull(form.get("notes"))
      });

      setShowQuickAdd(false);
      await onRefresh();
    }, setActionError, setSubmitting, "Device added");
  }

  async function updateDevice(event: FormEvent<HTMLFormElement>) {
    if (!editingConnection) return;
    await runFormSubmit(event, async (form) => {
      const host = String(form.get("host") ?? "").trim();
      const port = Number(form.get("port") || (editingConnection.type === "ssh" ? 22 : 3389));
      await apiSend(`/api/connections/${editingConnection.id}`, "PATCH", {
        name: emptyToNull(form.get("connectionName")),
        host,
        port,
        usernameHint: emptyToNull(form.get("usernameHint")),
        credentialId: emptyToNull(form.get("credentialId")),
        folderId: emptyToNull(form.get("folderId")),
        notes: emptyToNull(form.get("notes"))
      });
      const resourceName = String(form.get("name") ?? "").trim();
      if (resourceName && editingConnection.resourceId) {
        await apiSend(`/api/resources/${editingConnection.resourceId}`, "PATCH", {
          name: resourceName,
          host,
          description: emptyToNull(form.get("description"))
        });
      }
      setEditingConnection(null);
      await onRefresh();
    }, setActionError, setSubmitting, "Device updated");
  }

  const markSessionConnected = useCallback(
    async (sessionId: string) => {
      if (sessionId.startsWith("pending-")) return;
      setTabs((current) =>
        current.map((tab) => (tab.id === sessionId ? { ...tab, state: "connected" } : tab))
      );
      try {
        await apiSend(`/api/sessions/history/${sessionId}`, "PATCH", { status: "connected" });
        await onRefresh();
      } catch {
        // Session still usable even if history update fails.
      }
    },
    [onRefresh, setTabs]
  );

  const markSessionFailed = useCallback(
    async (sessionId: string, message: string) => {
      if (sessionId.startsWith("pending-")) return;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === sessionId ? { ...tab, state: "failed", error: message, session: undefined } : tab
        )
      );
      try {
        await apiSend(`/api/sessions/history/${sessionId}`, "PATCH", {
          status: "failed",
          error: message
        });
        await onRefresh();
      } catch {
        // Tab state already reflects the failure.
      }
    },
    [onRefresh, setTabs]
  );

  return (
    <main className={`access-page access-page-remote ${fullscreen ? "is-fullscreen" : ""}`}>
      {!fullscreen ? (
        <header className="access-header access-header-compact">
          <div>
            <h2>Remote</h2>
            <span>SSH and RDP sessions in one place</span>
          </div>
          <div className="access-header-actions">
            {guacdReachable === null ? null : (
              <span className={`guacd-status ${guacdReachable ? "online" : "offline"}`}>
                {guacdReachable ? <Wifi size={14} /> : <WifiOff size={14} />}
                guacd {guacdReachable ? "online" : "offline"}
              </span>
            )}
            <button
              className={`icon-text-button ${showHistory ? "is-active" : ""}`}
              type="button"
              onClick={() => setShowHistory((value) => !value)}
            >
              <History size={15} />
              History
            </button>
            <button className="icon-text-button" type="button" onClick={() => void onRefresh()}>
              <RefreshCw size={15} />
              Sync
            </button>
            <button
              className={`icon-text-button ${showQuickAdd ? "is-active" : ""}`}
              type="button"
              onClick={() => setShowQuickAdd((value) => !value)}
            >
              <Plus size={15} />
              Add device
            </button>
          </div>
        </header>
      ) : null}

      {!fullscreen && guacdReachable === false ? (
        <div className="access-guacd-banner">
          <WifiOff size={16} />
          <span>guacd is offline. Start the guacd container before launching remote sessions.</span>
        </div>
      ) : null}

      <FormErrorBanner message={actionError} />

      {showQuickAdd && !fullscreen ? (
        <form className="access-quick-add" onSubmit={addDevice}>
          <div className="access-quick-add-head">
            <strong>Add remote device</strong>
            <button className="icon-button" type="button" title="Close" onClick={() => setShowQuickAdd(false)}>
              <X size={15} />
            </button>
          </div>
          <div className="access-quick-add-grid">
            <label>
              Protocol
              <select name="protocol" defaultValue="ssh">
                {CONNECTION_TYPES.map((type) => (
                  <option key={type} value={type}>{type.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label>Name<input name="name" required placeholder="Host name" /></label>
            <label>Host<input name="host" required placeholder="192.168.1.20" /></label>
            <label>Port<input name="port" type="number" min="1" max="65535" placeholder="22 / 3389" /></label>
            <label>
              Kind
              <select name="kind" defaultValue="server">
                {RESOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <label>Connection name<input name="connectionName" placeholder="Optional display name" /></label>
            <label>Username hint<input name="usernameHint" placeholder="root or DOMAIN\\admin" /></label>
            <label>
              Credential
              <select name="credentialId" defaultValue="">
                <option value="">Prompt or anonymous</option>
                {data.credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}
              </select>
            </label>
            <label>
              Folder
              <select name="folderId" defaultValue="">
                <option value="">Unfiled</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <label className="access-span-2">Notes<textarea name="notes" rows={2} /></label>
          </div>
          <label className="checkbox-row">
            <input name="favorite" type="checkbox" defaultChecked />
            Favorite resource
          </label>
          <button className="primary-button" type="submit" disabled={submitting} style={{ maxWidth: 220 }}>
            <Save size={15} /> Save device
          </button>
        </form>
      ) : null}

      {editingConnection && !fullscreen ? (
        <form className="access-quick-add" onSubmit={updateDevice}>
          <div className="access-quick-add-head">
            <Pencil size={18} />
            <strong>Edit {connectionTitle(editingConnection)}</strong>
            <button className="icon-button" type="button" title="Close" onClick={() => setEditingConnection(null)}>
              <X size={15} />
            </button>
          </div>
          <div className="access-quick-add-grid">
            <label>Name<input name="name" defaultValue={editingConnection.resource?.name ?? connectionTitle(editingConnection)} required /></label>
            <label>Host<input name="host" defaultValue={editingConnection.host} required /></label>
            <label>Port<input name="port" type="number" min="1" max="65535" defaultValue={editingConnection.port} /></label>
            <label>Connection name<input name="connectionName" defaultValue={editingConnection.name ?? ""} /></label>
            <label>Username hint<input name="usernameHint" defaultValue={editingConnection.usernameHint ?? ""} /></label>
            <label>
              Credential
              <select name="credentialId" defaultValue={editingConnection.credentialId ?? ""}>
                <option value="">Prompt or anonymous</option>
                {data.credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}
              </select>
            </label>
            <label>
              Folder
              <select name="folderId" defaultValue={editingConnection.folderId ?? ""}>
                <option value="">Unfiled</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <label className="access-span-2">Notes<textarea name="notes" rows={2} defaultValue={editingConnection.notes ?? ""} /></label>
          </div>
          <button className="primary-button" type="submit" disabled={submitting} style={{ maxWidth: 220 }}>
            <Save size={15} /> Save changes
          </button>
        </form>
      ) : null}

      <section className="access-console">
        <div className={`access-rail-column ${railCollapsed ? "is-collapsed" : ""}`}>
          {!fullscreen && !railCollapsed ? (
            <label className="search-box access-rail-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter devices"
              />
            </label>
          ) : null}

          <AccessDeviceRail
            connections={filteredDevices}
            folders={folders}
            tabs={tabs}
            activeConnectionId={activeConnectionId}
            launchingId={launchingId}
            connectDisabled={guacdReachable === false}
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((value) => !value)}
            onSelect={selectConnection}
            onEdit={(connection) => {
              setEditingConnection(connection);
              setShowQuickAdd(false);
            }}
          />
        </div>

        <div className="access-main">
          <div className="access-session-tabs">
            <div className="access-session-tab-strip">
              {tabs.map((tab) => (
                <button
                  className={`access-session-tab ${tab.id === activeTab?.id ? "active" : ""} state-${tab.state}`}
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <ProtocolIcon protocol={tab.protocol} size={14} />
                  <span className={`session-state-dot dot-${tab.state === "connected" ? "connected" : tab.state === "failed" ? "error" : "connecting"}`} />
                  <span className="access-session-tab-title">{tab.title}</span>
                  <small>{sessionStatusLabel(tab.state)}</small>
                  <X
                    size={14}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(tab);
                    }}
                  />
                </button>
              ))}
            </div>
            {tabs.some((tab) => tab.state === "failed" || tab.state === "closed") ? (
              <button className="icon-text-button subtle" type="button" onClick={closeEndedTabs} title="Close failed and closed tabs">
                <X size={14} /> Clear ended
              </button>
            ) : null}
          </div>

          <div className="access-session-stage">
            {tabs.map((tab) =>
              tab.session ? (
                <div
                  className={`access-session-pane ${tab.id === activeTab?.id ? "is-active" : ""}`}
                  key={tab.session.websocketPath}
                >
                  <GuacamoleDisplay
                    websocketPath={tab.session.websocketPath}
                    displayName={tab.title}
                    protocol={tab.protocol}
                    sessionHistoryId={tab.id}
                    onConnected={markSessionConnected}
                    onFailed={markSessionFailed}
                    onToggleFullscreen={() => toggleFullscreen(tab.id)}
                  />
                </div>
              ) : null
            )}
            {activeTab && !activeTab.session ? (
              <div className="empty-state access-session-empty">
                <ProtocolIcon protocol={activeTab.protocol} size={42} />
                <h2>{sessionStatusLabel(activeTab.state)}</h2>
                <p>{activeTab.error ?? `Started ${formatDateTime(activeTab.startedAt)}`}</p>
                {activeTab.state === "failed" ? (
                  <div className="access-session-empty-actions">
                    <button
                      className="icon-text-button"
                      type="button"
                      onClick={() => {
                        const connection = data.connections.find((item) => item.id === activeTab.connectionId);
                        if (connection) void launch(connection);
                      }}
                    >
                      <RotateCcw size={15} /> Retry connection
                    </button>
                    <button
                      className="icon-text-button subtle"
                      type="button"
                      onClick={() => {
                        const connection = data.connections.find((item) => item.id === activeTab.connectionId);
                        if (connection) {
                          setEditingConnection(connection);
                          setShowQuickAdd(false);
                        }
                      }}
                    >
                      <Pencil size={15} /> Edit device
                    </button>
                  </div>
                ) : null}
              </div>
            ) : !activeTab ? (
              <div className="empty-state access-session-empty">
                <ProtocolIcon protocol="ssh" size={42} />
                <h2>No active session</h2>
                <p>Select a device on the left to connect.</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {showHistory && !fullscreen ? (
        <section className="access-history-panel">
          <div className="section-heading">
            <h3><History size={16} /> Session history</h3>
            <button className="icon-button" type="button" title="Close history" onClick={() => setShowHistory(false)}>
              <ChevronDown size={15} />
            </button>
          </div>
          {sessionHistory.length > 0 ? (
            <div className="access-history-list">
              {sessionHistory.slice(0, 30).map((session) => (
                <div className="access-history-row" key={session.id}>
                  <span className={`access-history-icon access-device-icon-${session.protocol}`}>
                    <ProtocolIcon protocol={session.protocol} size={16} />
                  </span>
                  <span className="access-history-copy">
                    <strong>{session.resourceName}</strong>
                    <small>
                      {session.connectionName ?? session.host}:{session.port}
                      {" · "}{sessionStatusLabel(session.status)}
                      {" · "}{formatDateTime(session.startedAt)}
                    </small>
                  </span>
                  <span className={`access-history-status status-${session.status}`}>{session.status}</span>
                  {session.connectionId ? (
                    <button className="icon-text-button" type="button" onClick={() => void relaunchFromHistory(session)}>
                      <RotateCcw size={14} /> Reconnect
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No sessions recorded yet.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
