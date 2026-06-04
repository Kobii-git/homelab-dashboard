import { useEffect, useRef, useState } from "react";
import { Maximize2, RefreshCw } from "lucide-react";
import Guacamole from "guacamole-common-js";

type GuacamoleDisplayProps = {
  websocketPath: string;
  displayName: string;
  sessionHistoryId?: string;
  onConnected?: (sessionHistoryId: string) => void;
  onFailed?: (sessionHistoryId: string, message: string) => void;
  onToggleFullscreen?: () => void;
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
  onFailed,
  onToggleFullscreen
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
    const container = displayRef.current;
    if (!container) {
      return undefined;
    }

    container.innerHTML = "";
    container.tabIndex = 0;
    setState("connecting");
    setError(null);

    const tunnel = new Guacamole.WebSocketTunnel(websocketUrl(websocketPath));
    const client = new Guacamole.Client(tunnel);
    const display = client.getDisplay();
    const displayElement = display.getElement();
    displayElement.style.transformOrigin = "top left";
    container.appendChild(displayElement);

    let lastSentWidth = 0;
    let lastSentHeight = 0;
    let resizeTimer: number | undefined;

    // Scale the rendered remote display to fit the container while preserving
    // aspect ratio. display.getScale() is then used to translate mouse input.
    const rescale = () => {
      const nativeWidth = display.getWidth();
      const nativeHeight = display.getHeight();
      const rect = container.getBoundingClientRect();
      if (!nativeWidth || !nativeHeight || rect.width < 10 || rect.height < 10) {
        return;
      }
      display.scale(Math.min(rect.width / nativeWidth, rect.height / nativeHeight));
    };

    // Ask the remote to resize to match the container so it uses all the space
    // (terminals reflow, RDP uses display-update). Debounced to avoid flooding
    // guacd while the window is being dragged.
    const requestRemoteSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width < 10 || height < 10) {
        return;
      }
      if (width === lastSentWidth && height === lastSentHeight) {
        return;
      }
      lastSentWidth = width;
      lastSentHeight = height;
      try {
        client.sendSize(width, height);
      } catch {
        // Some protocols ignore resize; the scale fallback still fits the view.
      }
      rescale();
    };

    display.onresize = rescale;

    const mouse = new Guacamole.Mouse(displayElement);
    // The `true` flag makes the client divide coordinates by the current
    // display scale, so clicks land correctly on the scaled-to-fit display.
    mouse.onEach(["mousedown", "mouseup", "mousemove"], (event: { state: unknown }) => {
      client.sendMouseState(event.state, true);
    });

    const keyboard = new Guacamole.Keyboard(container);
    keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(requestRemoteSize, 200);
    });
    resizeObserver.observe(container);

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

      if (label === "connected") {
        // Match the remote to the panel once the session is live.
        requestRemoteSize();
        container.focus();
        if (
          sessionIdRef.current &&
          !sessionIdRef.current.startsWith("pending-") &&
          !connectedRef.current
        ) {
          connectedRef.current = true;
          onConnectedRef.current?.(sessionIdRef.current);
        }
      }

      if (label === "disconnected" || label === "error") {
        connectedRef.current = false;
      }
    };

    client.connect("");
    container.focus();

    return () => {
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      client.disconnect();
      displayElement.remove();
    };
  }, [websocketPath]);

  const stateClass = state === "connected" ? "connected" : state === "error" ? "error" : "connecting";

  return (
    <section className="session-stage" aria-label={displayName}>
      <div className="session-toolbar">
        <div className="session-toolbar-title">
          <span className={`session-state-dot dot-${stateClass}`} />
          <strong>{displayName}</strong>
        </div>
        <div className="session-toolbar-actions">
          <span className={`session-state state-${stateClass}`}>
            {state === "connecting" || state === "waiting" ? <RefreshCw size={12} className="spin" /> : null}
            {state}
          </span>
          {onToggleFullscreen ? (
            <button className="icon-button" type="button" title="Toggle fullscreen" onClick={onToggleFullscreen}>
              <Maximize2 size={14} />
            </button>
          ) : null}
        </div>
      </div>
      {error ? <div className="session-error">{error}</div> : null}
      <div className="guac-display" ref={displayRef} />
    </section>
  );
}
