import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";

type GuacamoleDisplayProps = {
  websocketPath: string;
  displayName: string;
  sessionHistoryId?: string;
  onConnected?: (sessionHistoryId: string) => void;
};

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function GuacamoleDisplay({
  websocketPath,
  displayName,
  sessionHistoryId,
  onConnected
}: GuacamoleDisplayProps) {
  const displayRef = useRef<HTMLDivElement | null>(null);
  const connectedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  const [state, setState] = useState("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    connectedRef.current = false;
  }, [websocketPath, sessionHistoryId]);

  useEffect(() => {
    if (!displayRef.current) {
      return undefined;
    }

    displayRef.current.innerHTML = "";
    displayRef.current.tabIndex = 0;

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

    client.onerror = (guacError: { message?: string }) => {
      setError(guacError.message ?? "Remote session failed");
      setState("error");
    };

    client.onstatechange = (clientState: number) => {
      const labels = ["idle", "connecting", "waiting", "connected", "disconnecting", "disconnected"];
      const label = labels[clientState] ?? "unknown";
      setState(label);

      if (
        label === "connected" &&
        sessionHistoryId &&
        !sessionHistoryId.startsWith("pending-") &&
        !connectedRef.current
      ) {
        connectedRef.current = true;
        onConnectedRef.current?.(sessionHistoryId);
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
  }, [websocketPath, sessionHistoryId]);

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
