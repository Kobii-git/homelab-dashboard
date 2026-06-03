import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";

type GuacamoleDisplayProps = {
  websocketPath: string;
  displayName: string;
  sessionHistoryId?: string;
  onConnected?: (sessionHistoryId: string) => void;
  onFailed?: (sessionHistoryId: string, message: string) => void;
};

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function GuacamoleDisplay({
  websocketPath,
  displayName,
  sessionHistoryId,
  onConnected,
  onFailed
}: GuacamoleDisplayProps) {
  const displayRef = useRef<HTMLDivElement | null>(null);
  const connectedRef = useRef(false);
  const failedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  const onFailedRef = useRef(onFailed);
  const sessionIdRef = useRef(sessionHistoryId);
  const [state, setState] = useState("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    sessionIdRef.current = sessionHistoryId;
  }, [sessionHistoryId]);

  useEffect(() => {
    connectedRef.current = false;
    failedRef.current = false;
  }, [websocketPath]);

  useEffect(() => {
    if (!displayRef.current) {
      return undefined;
    }

    displayRef.current.innerHTML = "";
    displayRef.current.tabIndex = 0;
    setState("connecting");
    setError(null);

    const tunnel = new Guacamole.WebSocketTunnel(websocketUrl(websocketPath));
    const client = new Guacamole.Client(tunnel);
    const displayElement = client.getDisplay().getElement();

    displayRef.current.appendChild(displayElement);

    const mouse = new Guacamole.Mouse(displayElement);
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (mouseState: unknown) => {
      client.sendMouseState(mouseState);
    };

    const keyboard = new Guacamole.Keyboard(displayRef.current);
    keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

    const reportFailure = (message: string) => {
      if (failedRef.current) {
        return;
      }

      failedRef.current = true;
      connectedRef.current = false;
      setError(message);
      setState("error");

      const sessionId = sessionIdRef.current;
      if (sessionId && !sessionId.startsWith("pending-")) {
        onFailedRef.current?.(sessionId, message);
      }
    };

    tunnel.onerror = (status: { code?: number; message?: string }) => {
      reportFailure(status.message ?? "Tunnel connection failed");
    };

    client.onerror = (guacError: { message?: string }) => {
      reportFailure(guacError.message ?? "Remote session failed");
    };

    client.onstatechange = (clientState: number) => {
      const labels = ["idle", "connecting", "waiting", "connected", "disconnecting", "disconnected"];
      const label = labels[clientState] ?? "unknown";
      setState(label);

      if (
        label === "connected" &&
        sessionIdRef.current &&
        !sessionIdRef.current.startsWith("pending-") &&
        !connectedRef.current
      ) {
        connectedRef.current = true;
        onConnectedRef.current?.(sessionIdRef.current);
      }

      if (label === "disconnected" || label === "error") {
        connectedRef.current = false;
      }
    };

    client.connect("");
    displayRef.current.focus();

    return () => {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      client.disconnect();
      displayElement.remove();
    };
  }, [websocketPath]);

  return (
    <section className="session-stage" aria-label={displayName}>
      <div className="session-toolbar">
        <strong>{displayName}</strong>
        <span className={`session-state state-${state}`}>{state}</span>
      </div>
      {error ? <div className="session-error">{error}</div> : null}
      <div className="guac-display" ref={displayRef} />
    </section>
  );
}
