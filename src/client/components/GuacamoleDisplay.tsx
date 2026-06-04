import { FormEvent, useEffect, useRef, useState } from "react";
import { ClipboardPaste, Keyboard as KeyboardIcon, Maximize2, RefreshCw, Send, X } from "lucide-react";
import Guacamole from "guacamole-common-js";
import { KEYSYM, textToKeysyms } from "../lib/keysyms";

type GuacamoleDisplayProps = {
  websocketPath: string;
  displayName: string;
  protocol?: "ssh" | "rdp";
  sessionHistoryId?: string;
  onConnected?: (sessionHistoryId: string) => void;
  onFailed?: (sessionHistoryId: string, message: string) => void;
  onToggleFullscreen?: () => void;
};

const RDP_MAX_WIDTH = 1920;
const RDP_MAX_HEIGHT = 1080;
const RESIZE_DEBOUNCE_MS = 350;

function websocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function capRdpSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, RDP_MAX_WIDTH / width, RDP_MAX_HEIGHT / height);
  return {
    width: Math.max(640, Math.floor(width * scale)),
    height: Math.max(480, Math.floor(height * scale))
  };
}

export function GuacamoleDisplay({
  websocketPath,
  displayName,
  protocol = "ssh",
  sessionHistoryId,
  onConnected,
  onFailed,
  onToggleFullscreen
}: GuacamoleDisplayProps) {
  const displayRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<{ sendKeyEvent: (state: number, keysym: number) => void; sendSize: (w: number, h: number) => void } | null>(null);
  const connectedRef = useRef(false);
  const failedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  const onFailedRef = useRef(onFailed);
  const sessionIdRef = useRef(sessionHistoryId);
  const [state, setState] = useState("connecting");
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");

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
    clientRef.current = client;
    const display = client.getDisplay();
    const displayElement = display.getElement();
    const isRdp = protocol === "rdp";

    displayElement.style.transformOrigin = "top left";
    container.classList.toggle("guac-display-rdp", isRdp);
    container.classList.toggle("guac-display-ssh", !isRdp);
    container.appendChild(displayElement);

    let lastSentWidth = 0;
    let lastSentHeight = 0;
    let resizeTimer: number | undefined;
    let layoutTimer: number | undefined;

    const layoutDisplay = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width < 10 || height < 10) {
        return;
      }

      if (isRdp) {
        const nativeWidth = display.getWidth();
        const nativeHeight = display.getHeight();
        if (nativeWidth > 0 && nativeHeight > 0) {
          display.scale(Math.min(rect.width / nativeWidth, rect.height / nativeHeight));
        }
        return;
      }

      // SSH: match the terminal to the panel — no downscaling.
      display.scale(1);
      if (width === lastSentWidth && height === lastSentHeight) {
        return;
      }
      lastSentWidth = width;
      lastSentHeight = height;
      try {
        client.sendSize(width, height);
      } catch {
        // Terminal resize not supported on this session.
      }
    };

    const requestRemoteSize = () => {
      const rect = container.getBoundingClientRect();
      let width = Math.floor(rect.width);
      let height = Math.floor(rect.height);
      if (width < 10 || height < 10) {
        return;
      }

      if (isRdp) {
        ({ width, height } = capRdpSize(width, height));
      }

      if (width === lastSentWidth && height === lastSentHeight) {
        layoutDisplay();
        return;
      }

      lastSentWidth = width;
      lastSentHeight = height;
      try {
        client.sendSize(width, height);
      } catch {
        // Remote may ignore resize.
      }
      layoutDisplay();
    };

    const scheduleLayout = () => {
      window.clearTimeout(layoutTimer);
      layoutTimer = window.setTimeout(layoutDisplay, 50);
    };

    display.onresize = scheduleLayout;

    const mouse = new Guacamole.Mouse(displayElement);
    mouse.onEach(["mousedown", "mouseup", "mousemove"], (event: { state: unknown }) => {
      client.sendMouseState(event.state, isRdp);
    });

    const keyboard = new Guacamole.Keyboard(container);
    keyboard.onkeydown = (keysym: number) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym: number) => client.sendKeyEvent(0, keysym);

    client.onclipboard = (stream: unknown, mimetype: string) => {
      if (!mimetype.startsWith("text/")) {
        return;
      }
      try {
        const reader = new Guacamole.StringReader(stream);
        let text = "";
        reader.ontext = (chunk: string) => {
          text += chunk;
        };
        reader.onend = () => {
          if (window.isSecureContext && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
          }
        };
      } catch {
        // Ignore unreadable clipboard streams.
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(requestRemoteSize, RESIZE_DEBOUNCE_MS);
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
      window.clearTimeout(layoutTimer);
      resizeObserver.disconnect();
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      clientRef.current = null;
      client.disconnect();
      displayElement.remove();
      container.classList.remove("guac-display-rdp", "guac-display-ssh");
    };
  }, [websocketPath, protocol]);

  function sendText(text: string) {
    const client = clientRef.current;
    if (!client || !text) {
      return;
    }
    for (const keysym of textToKeysyms(text)) {
      client.sendKeyEvent(1, keysym);
      client.sendKeyEvent(0, keysym);
    }
    displayRef.current?.focus();
  }

  function sendKeyCombo(...keysyms: number[]) {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    for (const keysym of keysyms) {
      client.sendKeyEvent(1, keysym);
    }
    for (const keysym of [...keysyms].reverse()) {
      client.sendKeyEvent(0, keysym);
    }
    displayRef.current?.focus();
  }

  function submitPaste(event: FormEvent) {
    event.preventDefault();
    sendText(pasteValue);
    setPasteValue("");
    setPasteOpen(false);
  }

  const stateClass = state === "connected" ? "connected" : state === "error" ? "error" : "connecting";
  const live = state === "connected";

  return (
    <section className={`session-stage session-stage-${protocol}`} aria-label={displayName}>
      <div className="session-toolbar">
        <div className="session-toolbar-title">
          <span className={`session-state-dot dot-${stateClass}`} />
          <strong>{displayName}</strong>
        </div>
        <div className="session-toolbar-actions">
          {live ? (
            <>
              <button
                className={`icon-button ${pasteOpen ? "is-active" : ""}`}
                type="button"
                title="Paste / send text"
                onClick={() => setPasteOpen((value) => !value)}
              >
                <ClipboardPaste size={14} />
              </button>
              {protocol === "rdp" ? (
                <button
                  className="icon-button"
                  type="button"
                  title="Send Ctrl+Alt+Del"
                  onClick={() => sendKeyCombo(KEYSYM.ctrl, KEYSYM.alt, KEYSYM.delete)}
                >
                  <KeyboardIcon size={14} />
                </button>
              ) : null}
            </>
          ) : null}
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

      {pasteOpen && live ? (
        <form className="session-paste-bar" onSubmit={submitPaste}>
          <textarea
            autoFocus
            value={pasteValue}
            onChange={(event) => setPasteValue(event.target.value)}
            placeholder="Paste or type text to send to the session…"
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                submitPaste(event);
              }
              if (event.key === "Escape") {
                setPasteOpen(false);
              }
            }}
          />
          <div className="session-paste-actions">
            <button className="primary-button" type="submit" disabled={!pasteValue}>
              <Send size={14} /> Send
            </button>
            <button
              className="icon-button"
              type="button"
              title="Close"
              onClick={() => {
                setPasteOpen(false);
                setPasteValue("");
              }}
            >
              <X size={14} />
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="session-error">{error}</div> : null}
      <div className="guac-display" ref={displayRef} />
    </section>
  );
}
