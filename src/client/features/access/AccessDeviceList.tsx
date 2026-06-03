import { Activity, Pencil, Play, RefreshCw, Star } from "lucide-react";
import type { ConnectionDto } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { ReachabilityState } from "./AccessDeviceCard";
import { ProtocolIcon, type Protocol } from "./accessUtils";

function connectionTitle(connection: ConnectionDto): string {
  return connection.name ?? connection.resource?.name ?? connection.host;
}

export function AccessDeviceList({
  connections,
  launchingId,
  reachability,
  connectDisabled = false,
  monitoredIds,
  onConnect,
  onTest,
  onEdit,
  onMonitor
}: {
  connections: ConnectionDto[];
  launchingId: string | null;
  reachability: Record<string, ReachabilityState>;
  connectDisabled?: boolean;
  monitoredIds: Set<string>;
  onConnect: (connection: ConnectionDto) => void;
  onTest: (connection: ConnectionDto) => void;
  onEdit: (connection: ConnectionDto) => void;
  onMonitor: (connection: ConnectionDto) => void;
}) {
  return (
    <div className="access-device-list">
      <div className="access-device-list-head" aria-hidden="true">
        <span>Device</span>
        <span>Host</span>
        <span>User</span>
        <span>Last used</span>
        <span>Reachability</span>
        <span>Actions</span>
      </div>
      {connections.map((connection) => {
        const state = reachability[connection.id] ?? { status: "idle" };
        const protocol = connection.type as Protocol;

        return (
          <article className="access-device-list-row" key={connection.id}>
            <span className="access-device-list-name">
              <span className={`access-device-icon access-device-icon-${connection.type}`}>
                <ProtocolIcon protocol={protocol} size={16} />
              </span>
              <span>
                <strong>{connectionTitle(connection)}</strong>
                {connection.favorite ? <Star size={12} className="access-device-fav" /> : null}
                <small>{connection.credential?.label ?? "No vault credential"}</small>
              </span>
            </span>
            <span className="access-device-list-host">{connection.host}:{connection.port}</span>
            <span>{connection.usernameHint ?? connection.credential?.username ?? "—"}</span>
            <span>{formatDateTime(connection.lastLaunchedAt)}</span>
            <span className="access-device-list-reach">
              {state.status === "testing" ? "Testing…" : null}
              {state.status === "ok" ? `${state.latencyMs}ms` : null}
              {state.status === "fail" ? state.message : null}
              {state.status === "idle" ? "—" : null}
            </span>
            <span className="access-device-list-actions">
              <button className="icon-text-button" type="button" onClick={() => onEdit(connection)}>
                <Pencil size={14} />
                Edit
              </button>
              <button
                className={`icon-text-button ${monitoredIds.has(connection.id) ? "is-active" : ""}`}
                type="button"
                onClick={() => onMonitor(connection)}
              >
                <Activity size={14} />
                {monitoredIds.has(connection.id) ? "Monitored" : "Monitor"}
              </button>
              <button
                className="icon-text-button"
                type="button"
                disabled={state.status === "testing"}
                onClick={() => onTest(connection)}
              >
                {state.status === "testing" ? <RefreshCw className="spin" size={14} /> : <Activity size={14} />}
                Test
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={launchingId === connection.id || connectDisabled}
                onClick={() => onConnect(connection)}
              >
                {launchingId === connection.id ? <RefreshCw className="spin" size={14} /> : <Play size={14} />}
                Connect
              </button>
            </span>
          </article>
        );
      })}
    </div>
  );
}
