import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";

type GuacamoleDisplayProps = {
  websocketPath: string;
  displayName: string;
};

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function GuacamoleDisplay({ websocketPath, displayName }: GuacamoleDisplayProps) {
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!displayRef.current) {
      return undefined;
    }

    displayRef.current.innerHTML = "";
    const tunnel = new Guacamole.WebSocketTunnel(websocketUrl(websocketPath));
    const client = new Guacamole.Client(tunnel);
    const displayElement = client.getDisplay().getElement();

    displayRef.current.appendChild(displayElement);

    const mouse = new Guacamole.Mouse(displayElement);
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (mouseState: unknown) => {
      client.sendMouseState(mouseState);
    };

    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

    client.onerror = (guacError: { message?: string }) => {
      setError(guacError.message ?? "Remote session failed");
      setState("error");
    };

    client.onstatechange = (clientState: number) => {
      const labels = ["idle", "connecting", "waiting", "connected", "disconnecting", "disconnected"];
      setState(labels[clientState] ?? "unknown");
    };

    client.connect("");

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
