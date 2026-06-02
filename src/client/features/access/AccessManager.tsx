import { History, Maximize2, Monitor, Play, RefreshCw, Search, TerminalSquare, X } from "lucide-react";
import { useMemo, useState } from "react";
import { GuacamoleDisplay } from "../../components/GuacamoleDisplay";
import type { ConnectionDto, SessionLaunchDto } from "../../lib/api";
import { apiSend } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { V2Data } from "../types";

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
  onRefresh
}: {
  data: V2Data;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<RemoteTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const folders = data.folders.filter((folder) => folder.type === "connection" || folder.type === "mixed");

  const filteredConnections = useMemo(
    () =>
      data.connections.filter((connection) => {
        const haystack = `${connection.name ?? ""} ${connection.resource?.name ?? ""} ${connection.host} ${connection.type}`;
        return haystack.toLowerCase().includes(query.toLowerCase());
      }),
    [data.connections, query]
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

  return (
    <main className={`access-shell ${activeTab?.fullscreen ? "is-fullscreen" : ""}`}>
      <aside className="connection-rail">
        <div className="rail-header">
          <div>
            <h2>Access</h2>
            <span>{data.connections.length} remote endpoints</span>
          </div>
        </div>
        <label className="rail-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find host" />
        </label>
        <div className="folder-strip">
          <span>All</span>
          {folders.map((folder) => (
            <span key={folder.id}>{folder.name}</span>
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
                  {connection.type.toUpperCase()} {connection.host}:{connection.port}
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
