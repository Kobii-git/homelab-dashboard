import { ChevronDown, ChevronRight, Pencil, Play, RefreshCw, Star } from "lucide-react";
import { useMemo, useState } from "react";
import type { ConnectionDto, FolderDto } from "../../lib/api";
import { ProtocolIcon, type Protocol } from "./accessUtils";
import type { RemoteTab } from "./useRemoteSessions";

function connectionTitle(connection: ConnectionDto): string {
  return connection.name ?? connection.resource?.name ?? connection.host;
}

type RailGroup = {
  id: string;
  label: string;
  protocol: Protocol;
  connections: ConnectionDto[];
};

function buildGroups(connections: ConnectionDto[], folders: FolderDto[]): RailGroup[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const protocols: Protocol[] = ["ssh", "rdp"];
  const groups: RailGroup[] = [];

  for (const protocol of protocols) {
    const forProtocol = connections.filter((connection) => connection.type === protocol);
    if (forProtocol.length === 0) {
      continue;
    }

    const byFolder = new Map<string, ConnectionDto[]>();
    for (const connection of forProtocol) {
      const key = connection.folderId ?? "__unfiled__";
      const list = byFolder.get(key) ?? [];
      list.push(connection);
      byFolder.set(key, list);
    }

    for (const [folderId, items] of byFolder) {
      const folderLabel =
        folderId === "__unfiled__" ? "Unfiled" : (folderById.get(folderId) ?? "Folder");
      groups.push({
        id: `${protocol}-${folderId}`,
        label: `${protocol.toUpperCase()} · ${folderLabel}`,
        protocol,
        connections: items.sort((a, b) => connectionTitle(a).localeCompare(connectionTitle(b)))
      });
    }
  }

  return groups;
}

export function AccessDeviceRail({
  connections,
  folders,
  tabs,
  activeConnectionId,
  launchingId,
  connectDisabled,
  collapsed,
  onToggleCollapse,
  onSelect,
  onEdit
}: {
  connections: ConnectionDto[];
  folders: FolderDto[];
  tabs: RemoteTab[];
  activeConnectionId: string | null;
  launchingId: string | null;
  connectDisabled: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: (connection: ConnectionDto) => void;
  onEdit: (connection: ConnectionDto) => void;
}) {
  const groups = useMemo(() => buildGroups(connections, folders), [connections, folders]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const tabByConnection = useMemo(() => {
    const map = new Map<string, RemoteTab>();
    for (const tab of tabs) {
      map.set(tab.connectionId, tab);
    }
    return map;
  }, [tabs]);

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  if (collapsed) {
    return (
      <aside className="access-device-rail is-collapsed">
        <button className="access-rail-collapse" type="button" title="Expand devices" onClick={onToggleCollapse}>
          <ChevronRight size={16} />
        </button>
        <div className="access-rail-collapsed-list">
          {connections.map((connection) => {
            const tab = tabByConnection.get(connection.id);
            const active = activeConnectionId === connection.id;
            return (
              <button
                key={connection.id}
                className={`access-rail-icon-btn ${active ? "active" : ""} state-${tab?.state ?? "idle"}`}
                type="button"
                title={connectionTitle(connection)}
                disabled={connectDisabled && !tab}
                onClick={() => onSelect(connection)}
              >
                <ProtocolIcon protocol={connection.type as Protocol} size={16} />
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="access-device-rail">
      <div className="access-rail-head">
        <strong>Devices</strong>
        <span className="access-rail-count">{connections.length}</span>
        <button className="access-rail-collapse" type="button" title="Collapse devices" onClick={onToggleCollapse}>
          <ChevronDown size={16} />
        </button>
      </div>

      <div className="access-rail-scroll">
        {groups.length === 0 ? (
          <p className="access-rail-empty">No connections yet.</p>
        ) : (
          groups.map((group) => {
            const folded = collapsedGroups[group.id] ?? false;
            return (
              <section className="access-rail-group" key={group.id}>
                <button className="access-rail-group-head" type="button" onClick={() => toggleGroup(group.id)}>
                  {folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span>{group.label}</span>
                  <small>{group.connections.length}</small>
                </button>
                {!folded ? (
                  <div className="access-rail-group-items">
                    {group.connections.map((connection) => {
                      const tab = tabByConnection.get(connection.id);
                      const active = activeConnectionId === connection.id;
                      const launching = launchingId === connection.id;

                      return (
                        <div
                          key={connection.id}
                          className={`access-rail-item ${active ? "active" : ""} ${tab ? `state-${tab.state}` : ""}`}
                        >
                          <button
                            className="access-rail-item-main"
                            type="button"
                            disabled={connectDisabled && !tab && !launching}
                            onClick={() => onSelect(connection)}
                          >
                            <span className={`access-device-icon access-device-icon-${connection.type}`}>
                              <ProtocolIcon protocol={connection.type as Protocol} size={14} />
                            </span>
                            <span className="access-rail-item-copy">
                              <strong>
                                {connectionTitle(connection)}
                                {connection.favorite ? <Star size={11} className="access-device-fav" /> : null}
                              </strong>
                              <small>{connection.host}:{connection.port}</small>
                            </span>
                            {tab ? (
                              <span
                                className={`session-state-dot dot-${
                                  tab.state === "connected"
                                    ? "connected"
                                    : tab.state === "failed"
                                      ? "error"
                                      : "connecting"
                                }`}
                              />
                            ) : null}
                            {launching ? <RefreshCw className="spin access-rail-spin" size={14} /> : null}
                          </button>
                          <button
                            className="icon-button access-rail-edit"
                            type="button"
                            title="Edit device"
                            onClick={() => onEdit(connection)}
                          >
                            <Pencil size={13} />
                          </button>
                          {!tab ? (
                            <button
                              className="icon-button access-rail-connect"
                              type="button"
                              title="Connect"
                              disabled={launching || connectDisabled}
                              onClick={() => onSelect(connection)}
                            >
                              <Play size={13} />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}
