import {
  History,
  LayoutGrid,
  List,
  Maximize2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { RESOURCE_KINDS } from "../../../shared/types";
import { EmptyPanel, MetricCard } from "../../components/Primitives";
import { GuacamoleDisplay } from "../../components/GuacamoleDisplay";
import { AccessDeviceCard, type ReachabilityState } from "./AccessDeviceCard";
import { AccessDeviceList } from "./AccessDeviceList";
import { ProtocolIcon, sessionStatusLabel, type Protocol } from "./accessUtils";
import type { RemoteTab } from "./useRemoteSessions";
import type { ConnectionDto, SessionHistoryDto, SessionLaunchDto } from "../../lib/api";
import { apiGet, apiSend, emptyToNull } from "../../lib/api";
import { FormErrorBanner, runFormAction } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";
import type { DashboardResource } from "../../../shared/types";

type AccessView = "devices" | "sessions";
type DeviceLayout = "grid" | "list";

const PAGE_COPY: Record<Protocol, { title: string; subtitle: string }> = {
  ssh: { title: "SSH", subtitle: "Terminal access to servers and VMs" },
  rdp: { title: "Remote Desktop", subtitle: "Browser RDP sessions for Windows VMs" }
};

export function AccessManager({
  protocol,
  data,
  onRefresh,
  tabs,
  setTabs,
  activeTabId,
  setActiveTabId,
  launchConnectionId,
  onLaunchHandled
}: {
  protocol: Protocol;
  data: V2Data;
  onRefresh: () => Promise<void>;
  tabs: RemoteTab[];
  setTabs: Dispatch<SetStateAction<RemoteTab[]>>;
  activeTabId: string | null;
  setActiveTabId: (tabId: string | null) => void;
  launchConnectionId?: string | null;
  onLaunchHandled?: () => void;
}) {
  const [view, setView] = useState<AccessView>("devices");
  const [deviceLayout, setDeviceLayout] = useState<DeviceLayout>("list");
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [guacdReachable, setGuacdReachable] = useState<boolean | null>(null);
  const [reachability, setReachability] = useState<Record<string, ReachabilityState>>({});

  const copy = PAGE_COPY[protocol];
  const folders = data.folders.filter((folder) => folder.type === "connection" || folder.type === "mixed");
  const protocolConnections = useMemo(
    () => data.connections.filter((connection) => connection.type === protocol),
    [data.connections, protocol]
  );

  const filteredDevices = useMemo(
    () =>
      protocolConnections
        .filter((connection) => {
          const haystack = `${connection.name ?? ""} ${connection.resource?.name ?? ""} ${connection.host} ${connection.usernameHint ?? ""}`;
          const matchesQuery = haystack.toLowerCase().includes(query.toLowerCase());
          const matchesFolder = !folderFilter || connection.folderId === folderFilter;
          return matchesQuery && matchesFolder;
        })
        .sort((a, b) => {
          const fav = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
          if (fav !== 0) return fav;
          const aTime = a.lastLaunchedAt ? new Date(a.lastLaunchedAt).getTime() : 0;
          const bTime = b.lastLaunchedAt ? new Date(b.lastLaunchedAt).getTime() : 0;
          return bTime - aTime;
        }),
    [protocolConnections, query, folderFilter]
  );

  const protocolTabs = useMemo(() => tabs.filter((tab) => tab.protocol === protocol), [tabs, protocol]);

  const activeTab =
    protocolTabs.find((tab) => tab.id === activeTabId) ?? protocolTabs[0] ?? null;

  const protocolHistory = useMemo(
    () => data.sessionHistory.filter((session) => session.protocol === protocol),
    [data.sessionHistory, protocol]
  );

  const liveSessionCount = protocolTabs.filter((tab) => tab.state !== "closed").length;

  useEffect(() => {
    void refreshGuacd();
    const timer = window.setInterval(() => void refreshGuacd(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!launchConnectionId) return;
    const connection = data.connections.find((item) => item.id === launchConnectionId);
    onLaunchHandled?.();
    if (connection?.type === protocol) {
      setView("sessions");
      void launch(connection);
    }
  }, [launchConnectionId, protocol]);

  async function refreshGuacd() {
    try {
      const health = await apiGet<{ guacd: { reachable: boolean } }>("/api/health");
      setGuacdReachable(health.guacd.reachable);
    } catch {
      setGuacdReachable(false);
    }
  }

  async function launch(connection: ConnectionDto) {
    if (connection.type !== protocol) return;

    if (guacdReachable === false) {
      setActionError("guacd is offline — remote sessions cannot start until the tunnel service is reachable.");
      setView("sessions");
      return;
    }

    setLaunchingId(connection.id);
    setView("sessions");

    const tempId = `pending-${connection.id}-${Date.now()}`;
    const pendingTab: RemoteTab = {
      id: tempId,
      connectionId: connection.id,
      protocol: connection.type,
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
      const sessionId = session.sessionHistory?.id ?? tempId;
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tempId ? { ...tab, id: sessionId, state: "connected", session } : tab
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

  async function closeTab(tab: RemoteTab) {
    if (!tab.id.startsWith("pending-")) {
      await apiSend(`/api/sessions/history/${tab.id}`, "PATCH", {
        status: tab.state === "failed" ? "failed" : "closed",
        error: tab.error ?? null
      });
    }
    const nextTabs = tabs.filter((item) => item.id !== tab.id);
    setTabs(nextTabs);
    const nextForProtocol = nextTabs.filter((item) => item.protocol === protocol);
    setActiveTabId(nextForProtocol[0]?.id ?? null);
    await onRefresh();
  }

  async function relaunchFromHistory(session: SessionHistoryDto) {
    if (!session.connectionId) return;
    const connection = data.connections.find((item) => item.id === session.connectionId);
    if (connection) await launch(connection);
  }

  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runFormAction(async () => {
      const form = new FormData(event.currentTarget);
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
        folderId: emptyToNull(form.get("folderId")) ?? folderFilter,
        favorite: true,
        notes: emptyToNull(form.get("notes"))
      });

      event.currentTarget.reset();
      setShowQuickAdd(false);
      await onRefresh();
    }, setActionError, setSubmitting, "Device added");
  }

  async function testDevice(connection: ConnectionDto) {
    setReachability((current) => ({ ...current, [connection.id]: { status: "testing" } }));
    try {
      const result = await apiSend<{ ok: boolean; latencyMs: number; error: string | null }>(
        "/api/connections/test",
        "POST",
        { host: connection.host, port: connection.port, type: connection.type }
      );
      setReachability((current) => ({
        ...current,
        [connection.id]: result.ok
          ? { status: "ok", latencyMs: result.latencyMs }
          : { status: "fail", message: result.error ?? "Unreachable" }
      }));
    } catch (error) {
      setReachability((current) => ({
        ...current,
        [connection.id]: {
          status: "fail",
          message: error instanceof Error ? error.message : "Test failed"
        }
      }));
    }
  }

  function connectionTitle(connection: ConnectionDto): string {
    return connection.name ?? connection.resource?.name ?? connection.host;
  }

  const fullscreen = activeTab?.fullscreen ?? false;

  return (
    <main className={`access-page access-page-${protocol} ${fullscreen ? "is-fullscreen" : ""}`}>
      {!fullscreen ? (
        <header className="access-header">
          <div>
            <h2>{copy.title}</h2>
            <span>{copy.subtitle}</span>
          </div>
          <div className="access-header-actions">
            {guacdReachable === null ? null : (
              <span className={`guacd-status ${guacdReachable ? "online" : "offline"}`}>
                {guacdReachable ? <Wifi size={14} /> : <WifiOff size={14} />}
                guacd {guacdReachable ? "online" : "offline"}
              </span>
            )}
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
          <span>guacd is offline. Start the guacd container before launching {protocol.toUpperCase()} sessions.</span>
        </div>
      ) : null}

      {!fullscreen ? (
        <>
          <section className="access-overview access-overview-compact">
            <MetricCard icon={<ProtocolIcon protocol={protocol} size={18} />} label="Devices" value={protocolConnections.length} tone="accent" />
            <MetricCard icon={<Play size={18} />} label="Live sessions" value={liveSessionCount} tone="online" />
            <MetricCard icon={<History size={18} />} label="History" value={protocolHistory.length} />
          </section>

          <div className="access-view-tabs" role="tablist" aria-label={`${protocol.toUpperCase()} view`}>
            <button
              className={view === "devices" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={view === "devices"}
              onClick={() => setView("devices")}
            >
              <Server size={15} />
              Devices
              <span className="access-tab-count">{protocolConnections.length}</span>
            </button>
            <button
              className={view === "sessions" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={view === "sessions"}
              onClick={() => setView("sessions")}
            >
              <ProtocolIcon protocol={protocol} size={15} />
              Sessions
              {liveSessionCount > 0 ? <span className="access-tab-count">{liveSessionCount}</span> : null}
            </button>
          </div>
        </>
      ) : null}

      <FormErrorBanner message={actionError} />

      {showQuickAdd && !fullscreen ? (
        <form className="access-quick-add" onSubmit={addDevice}>
          <div className="access-quick-add-head">
            <ProtocolIcon protocol={protocol} size={18} />
            <strong>Add {protocol.toUpperCase()} device</strong>
            <button className="icon-button" type="button" title="Close" onClick={() => setShowQuickAdd(false)}>
              <X size={15} />
            </button>
          </div>
          <div className="access-quick-add-grid">
            <label>Name<input name="name" required placeholder={protocol === "ssh" ? "Ubuntu host" : "Windows VM"} /></label>
            <label>Host<input name="host" required placeholder="192.168.1.20" /></label>
            <label>
              Port
              <input name="port" type="number" min="1" max="65535" placeholder={protocol === "ssh" ? "22" : "3389"} />
            </label>
            <label>
              Kind
              <select name="kind" defaultValue="server">
                {RESOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <label>Connection name<input name="connectionName" placeholder={`${protocol.toUpperCase()} session`} /></label>
            <label>
              Username hint
              <input name="usernameHint" placeholder={protocol === "ssh" ? "root" : "DOMAIN\\admin"} />
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
            <label>URL<input name="url" placeholder="Optional web console" /></label>
            <label className="access-span-2">Description<textarea name="description" rows={2} /></label>
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

      {fullscreen || view === "sessions" ? (
        <section className="access-sessions-panel">
          <div className="access-session-tabs">
            {protocolTabs.map((tab) => (
              <button
                className={`access-session-tab ${tab.id === activeTab?.id ? "active" : ""} state-${tab.state}`}
                type="button"
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
              >
                <ProtocolIcon protocol={tab.protocol} size={14} />
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

          <div className="access-session-stage">
            {activeTab?.session ? (
              <GuacamoleDisplay websocketPath={activeTab.session.websocketPath} displayName={activeTab.title} />
            ) : activeTab ? (
              <div className="empty-state access-session-empty">
                <ProtocolIcon protocol={activeTab.protocol} size={42} />
                <h2>{sessionStatusLabel(activeTab.state)}</h2>
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
                    <RotateCcw size={15} /> Retry connection
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="empty-state access-session-empty">
                <ProtocolIcon protocol={protocol} size={42} />
                <h2>No {protocol.toUpperCase()} session</h2>
                <p>Pick a device from the Devices tab or reconnect from history below.</p>
                <button className="icon-text-button" type="button" onClick={() => setView("devices")}>
                  <Server size={15} /> Browse devices
                </button>
              </div>
            )}
          </div>

          {!fullscreen ? (
            <section className="access-history-panel">
              <div className="section-heading">
                <h3><History size={16} /> {protocol.toUpperCase()} history</h3>
                <span>{protocolHistory.length}</span>
              </div>
              {protocolHistory.length > 0 ? (
                <div className="access-history-list">
                  {protocolHistory.slice(0, 20).map((session) => (
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
                          {session.hasCredential ? " · vault" : ""}
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
                <p className="muted-copy">No {protocol.toUpperCase()} sessions recorded yet.</p>
              )}
            </section>
          ) : null}
        </section>
      ) : (
        <section className="access-devices-panel">
          <div className="access-toolbar">
            <label className="search-box access-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${filteredDevices.length} ${protocol.toUpperCase()} devices`}
              />
            </label>
            <div className="access-toolbar-row">
              <div className="folder-strip">
                <span className={`folder-chip ${!folderFilter ? "active" : ""}`} onClick={() => setFolderFilter(null)}>All</span>
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
              <div className="access-layout-toggle" role="group" aria-label="Device layout">
                <button
                  className={deviceLayout === "list" ? "active" : ""}
                  type="button"
                  title="List view"
                  onClick={() => setDeviceLayout("list")}
                >
                  <List size={15} />
                </button>
                <button
                  className={deviceLayout === "grid" ? "active" : ""}
                  type="button"
                  title="Grid view"
                  onClick={() => setDeviceLayout("grid")}
                >
                  <LayoutGrid size={15} />
                </button>
              </div>
            </div>
          </div>

          {filteredDevices.length > 0 ? (
            deviceLayout === "list" ? (
              <AccessDeviceList
                connections={filteredDevices}
                launchingId={launchingId}
                reachability={reachability}
                onConnect={(connection) => void launch(connection)}
                onTest={(connection) => void testDevice(connection)}
              />
            ) : (
              <div className="access-device-grid">
                {filteredDevices.map((connection) => (
                  <AccessDeviceCard
                    key={connection.id}
                    connection={connection}
                    launching={launchingId === connection.id}
                    reachability={reachability[connection.id] ?? { status: "idle" }}
                    onConnect={() => void launch(connection)}
                    onTest={() => void testDevice(connection)}
                  />
                ))}
              </div>
            )
          ) : (
            <EmptyPanel
              icon={<ProtocolIcon protocol={protocol} size={36} />}
              title={`No ${protocol.toUpperCase()} devices`}
              body={`Add a ${protocol.toUpperCase()} connection here or in Inventory.`}
              action={
                <button className="icon-text-button" type="button" onClick={() => setShowQuickAdd(true)}>
                  <Plus size={15} /> Add device
                </button>
              }
            />
          )}
        </section>
      )}
    </main>
  );
}
