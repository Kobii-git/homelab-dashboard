import { Activity, Play, RefreshCw, Star } from "lucide-react";
import type { ConnectionDto } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { ProtocolIcon, type Protocol } from "./accessUtils";

export type ReachabilityState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; latencyMs: number }
  | { status: "fail"; message: string };

function connectionTitle(connection: ConnectionDto): string {
  return connection.name ?? connection.resource?.name ?? connection.host;
}

export function AccessDeviceCard({
  connection,
  launching,
  reachability,
  onConnect,
  onTest
}: {
  connection: ConnectionDto;
  launching: boolean;
  reachability: ReachabilityState;
  onConnect: () => void;
  onTest: () => void;
}) {
  const protocol = connection.type as Protocol;

  return (
    <article className="access-device-card">
      <div className="access-device-card-head">
        <span className={`access-device-icon access-device-icon-${connection.type}`}>
          <ProtocolIcon protocol={protocol} size={20} />
        </span>
        <div>
          <h3>{connectionTitle(connection)}</h3>
          <p>{connection.resource?.name ?? connection.host}</p>
        </div>
        {connection.favorite ? <Star size={14} className="access-device-fav" /> : null}
      </div>
      <dl className="access-device-meta">
        <div><dt>Host</dt><dd>{connection.host}:{connection.port}</dd></div>
        <div><dt>User</dt><dd>{connection.usernameHint ?? connection.credential?.username ?? "—"}</dd></div>
        <div><dt>Vault</dt><dd>{connection.credential?.label ?? "No credential"}</dd></div>
        <div><dt>Last used</dt><dd>{formatDateTime(connection.lastLaunchedAt)}</dd></div>
      </dl>
      {reachability.status === "ok" ? (
        <p className="access-reachability ok">Reachable in {reachability.latencyMs}ms</p>
      ) : reachability.status === "fail" ? (
        <p className="access-reachability fail">{reachability.message}</p>
      ) : null}
      <div className="access-device-actions">
        <button
          className="icon-text-button"
          type="button"
          disabled={reachability.status === "testing"}
          onClick={onTest}
        >
          {reachability.status === "testing" ? <RefreshCw className="spin" size={14} /> : <Activity size={14} />}
          Test port
        </button>
        <button
          className="primary-button access-connect-btn"
          type="button"
          disabled={launching}
          onClick={onConnect}
        >
          {launching ? <RefreshCw className="spin" size={15} /> : <Play size={15} />}
          Connect
        </button>
      </div>
    </article>
  );
}
