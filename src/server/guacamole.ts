import crypto from "node:crypto";
import net from "node:net";
import type { RawData, WebSocket } from "ws";
import type { ConnectionType } from "../shared/types.js";
import type { PlainCredential } from "./vault.js";

export type GuacamoleSessionConfig = {
  protocol: ConnectionType;
  host: string;
  port: number;
  displayName: string;
  usernameHint?: string | null;
  credential?: PlainCredential;
};

type StoredSession = {
  config: GuacamoleSessionConfig;
  expiresAt: number;
};

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly tokensBySessionId = new Map<string, string>();

  create(config: GuacamoleSessionConfig, sessionId?: string, ttlMs = 60 * 60 * 1000): string {
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { config, expiresAt: Date.now() + ttlMs });
    if (sessionId) {
      this.tokensBySessionId.set(sessionId, token);
    }
    return token;
  }

  get(token: string | null | undefined): GuacamoleSessionConfig | undefined {
    if (!token) {
      return undefined;
    }

    const session = this.sessions.get(token);

    if (!session) {
      return undefined;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }

    return session.config;
  }

  getBySessionId(sessionId: string | null | undefined): GuacamoleSessionConfig | undefined {
    if (!sessionId) {
      return undefined;
    }

    const token = this.tokensBySessionId.get(sessionId);
    return token ? this.get(token) : undefined;
  }

  resolve(token: string | null | undefined, sessionId: string | null | undefined): GuacamoleSessionConfig | undefined {
    return this.get(token) ?? this.getBySessionId(sessionId);
  }

  release(token: string): void {
    this.sessions.delete(token);
  }

  sweep(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(token);
      }
    }
  }
}

export function encodeInstruction(
  opcode: string,
  ...args: Array<string | number | null | undefined>
): string {
  const parts = [opcode, ...args.map((arg) => (arg == null ? "" : String(arg)))];
  return `${parts.map((part) => `${Buffer.byteLength(part, "utf8")}.${part}`).join(",")};`;
}

type Instruction = {
  opcode: string;
  args: string[];
};

class InstructionParser {
  private buffer = "";

  constructor(private readonly onInstruction: (instruction: Instruction) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;

    while (this.buffer.length > 0) {
      const instruction = this.readInstruction();

      if (!instruction) {
        return;
      }

      this.onInstruction(instruction);
    }
  }

  private readInstruction(): Instruction | undefined {
    const parts: string[] = [];
    let index = 0;

    while (index < this.buffer.length) {
      const dot = this.buffer.indexOf(".", index);

      if (dot === -1) {
        return undefined;
      }

      const length = Number(this.buffer.slice(index, dot));

      if (!Number.isFinite(length) || length < 0) {
        throw new Error("Invalid Guacamole instruction length");
      }

      const valueStart = dot + 1;
      const valueEnd = valueStart + length;

      if (this.buffer.length < valueEnd + 1) {
        return undefined;
      }

      parts.push(this.buffer.slice(valueStart, valueEnd));

      const delimiter = this.buffer[valueEnd];
      index = valueEnd + 1;

      if (delimiter === ";") {
        this.buffer = this.buffer.slice(index);
        const [opcode, ...args] = parts;
        return { opcode, args };
      }

      if (delimiter !== ",") {
        throw new Error("Invalid Guacamole instruction delimiter");
      }
    }

    return undefined;
  }
}

export function valueForArgument(config: GuacamoleSessionConfig, argument: string): string {
  const credential = config.credential ?? {};
  const username = credential.username ?? config.usernameHint ?? "";
  const password = credential.password ?? "";

  // RDP with no password can't complete Network Level Authentication, so use
  // legacy RDP security to present the Windows login screen instead of failing.
  // When a password is supplied, "any" lets guacd negotiate NLA/TLS as needed.
  const rdpSecurity = config.protocol === "rdp" && !password ? "rdp" : "any";

  const common: Record<string, string> = {
    hostname: config.host,
    port: String(config.port),
    username,
    password,
    domain: credential.domain ?? "",
    "ignore-cert": "true",
    security: rdpSecurity,
    "server-layout": "en-us-qwerty",
    "color-depth": config.protocol === "rdp" ? "16" : "32",
    "resize-method": "display-update",
    "enable-wallpaper": config.protocol === "rdp" ? "false" : "true",
    "enable-theming": "false",
    "enable-font-smoothing": config.protocol === "rdp" ? "false" : "true",
    "enable-full-window-drag": "false",
    "enable-desktop-composition": "false",
    "enable-menu-animations": "false",
    "disable-glyph-caching": config.protocol === "rdp" ? "true" : "false",
    "disable-offscreen-caching": config.protocol === "rdp" ? "true" : "false",
    "disable-bitmap-caching": config.protocol === "rdp" ? "false" : "false",
    "terminal-type": "xterm-256color",
    "font-size": "14",
    "private-key": credential.privateKey ?? "",
    passphrase: credential.passphrase ?? "",
    "recording-path": "",
    "recording-name": ""
  };

  return common[argument] ?? "";
}

function rawDataToBuffer(message: RawData): Buffer {
  if (Buffer.isBuffer(message)) {
    return message;
  }

  if (message instanceof ArrayBuffer) {
    return Buffer.from(message);
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message);
  }

  throw new Error("Unsupported WebSocket payload");
}

export function rewriteConnectInstruction(
  config: GuacamoleSessionConfig,
  connectArgNames: string[],
  instruction: Instruction
): string {
  const values =
    connectArgNames.length > 0
      ? connectArgNames.map((arg) => valueForArgument(config, arg))
      : instruction.args;

  return encodeInstruction("connect", ...values);
}

/**
 * Parse the first complete Guacamole instruction from the start of `str`.
 * Returns the opcode, its arguments, and the character index immediately
 * after the trailing `;`, or null if `str` does not yet contain a complete
 * instruction. Only used for the (ASCII) handshake phase.
 */
function parseFirstInstruction(str: string): { opcode: string; args: string[]; end: number } | null {
  const parts: string[] = [];
  let i = 0;

  while (i < str.length) {
    const dot = str.indexOf(".", i);
    if (dot === -1) {
      return null;
    }
    const length = Number(str.slice(i, dot));
    if (!Number.isFinite(length) || length < 0) {
      return null;
    }
    const valueStart = dot + 1;
    const valueEnd = valueStart + length;
    if (str.length < valueEnd + 1) {
      return null;
    }
    parts.push(str.slice(valueStart, valueEnd));
    const terminator = str[valueEnd];
    i = valueEnd + 1;
    if (terminator === ";") {
      const [opcode, ...args] = parts;
      return { opcode, args, end: i };
    }
    if (terminator !== ",") {
      return null;
    }
  }

  return null;
}

const HANDSHAKE_TIMEOUT_MS = 20_000;

/**
 * Bridge a browser WebSocket (guacamole-common-js) to a guacd TCP socket.
 *
 * guacamole-common-js does NOT perform the guacd handshake itself — calling
 * `client.connect()` only opens the tunnel and waits. The SERVER must drive
 * the full handshake with guacd, then relay the rendered session both ways:
 *
 *   server -> guacd : select,<protocol>
 *   guacd  -> server: args,VERSION_x,<param>,...
 *   server -> guacd : size / audio / video / image / timezone
 *   server -> guacd : connect,<value per param>   (vault creds injected here)
 *   guacd  -> server: ready,<id>                  (then the render stream)
 *
 * The protocol version is negotiated down to 1.1.0 (the highest this proxy
 * fully implements — matching the reference guacamole-lite behaviour), and on
 * `ready` the connection id is relayed to the browser as the empty-opcode
 * tunnel instruction guacamole-common-js expects. Only the ASCII handshake is
 * parsed; the render stream is relayed as raw bytes in both directions.
 */
export function wireGuacamoleTunnel(
  ws: WebSocket,
  config: GuacamoleSessionConfig,
  options: { host: string; port: number }
): void {
  const tag = `[guac ${config.protocol} ${config.host}:${config.port}]`;
  const log = (message: string) => console.log(`${tag} ${message}`);
  const logError = (message: string) => console.error(`${tag} ${message}`);

  const guacd = net.createConnection({ host: options.host, port: options.port });
  guacd.setNoDelay(true);

  let open = false; // true once guacd has sent `ready`
  let closed = false;
  let preBuffer = Buffer.alloc(0); // accumulates guacd handshake bytes
  const pendingClientMessages: Buffer[] = [];

  const wsOpen = () => ws.readyState === ws.OPEN;

  // The Guacamole protocol is text. guacamole-common-js's WebSocketTunnel only
  // parses TEXT frames — a binary frame is silently ignored, leaving the client
  // stuck on "Waiting". guacd output is valid UTF-8, so always send text frames.
  const sendToClient = (data: string | Buffer) => {
    if (!wsOpen()) {
      return;
    }
    if (typeof data === "string") {
      ws.send(data);
    } else {
      ws.send(data, { binary: false });
    }
  };

  const handshakeTimer = setTimeout(() => {
    if (!open) {
      logError("handshake timed out (no `ready` from guacd)");
      sendToClient(encodeInstruction("error", "guacd handshake timed out", "519"));
      closeBoth();
    }
  }, HANDSHAKE_TIMEOUT_MS);

  function closeBoth() {
    if (closed) {
      return;
    }
    closed = true;
    clearTimeout(handshakeTimer);
    guacd.destroy();
    if (wsOpen()) {
      ws.close();
    }
  }

  const flushPendingClientMessages = () => {
    for (const message of pendingClientMessages.splice(0)) {
      guacd.write(message);
    }
  };

  const sendHandshakeReply = (argNames: string[]) => {
    // Negotiate the protocol version down to what we fully support (1.1.0).
    let protocolVersion = "1_0_0";
    for (const name of argNames) {
      if (name.startsWith("VERSION_")) {
        const offered = name.slice("VERSION_".length);
        protocolVersion = offered === "1_0_0" ? "1_0_0" : "1_1_0";
        break;
      }
    }

    guacd.write(encodeInstruction("size", 1024, 768, 96));
    guacd.write(encodeInstruction("audio", "audio/L8", "audio/L16"));
    guacd.write(encodeInstruction("video"));
    guacd.write(encodeInstruction("image", "image/png", "image/jpeg", "image/webp"));
    if (protocolVersion === "1_1_0") {
      guacd.write(encodeInstruction("timezone"));
    }

    const values = argNames.map((name) =>
      name.startsWith("VERSION_") ? `VERSION_${protocolVersion}` : valueForArgument(config, name)
    );
    guacd.write(encodeInstruction("connect", ...values));
    log(`handshake reply sent (negotiated VERSION_${protocolVersion}, ${argNames.length} params)`);
  };

  const handleHandshakeData = (chunk: Buffer) => {
    preBuffer = Buffer.concat([preBuffer, chunk]);
    const text = preBuffer.toString("utf8"); // handshake traffic is ASCII
    let consumed = 0;

    for (;;) {
      const parsed = parseFirstInstruction(text.slice(consumed));
      if (!parsed) {
        break;
      }
      consumed += parsed.end;

      if (parsed.opcode === "args") {
        log(`received args (${parsed.args.length} params, offered ${parsed.args[0] ?? "?"})`);
        sendHandshakeReply(parsed.args);
      } else if (parsed.opcode === "error") {
        logError(`guacd error during handshake: ${parsed.args.join(" ")}`);
        sendToClient(encodeInstruction("error", ...parsed.args));
        closeBoth();
        return;
      } else if (parsed.opcode === "ready") {
        const connectionId = parsed.args[0] ?? "";
        log(`ready (${connectionId}) — relaying session`);
        open = true;
        clearTimeout(handshakeTimer);
        // guacamole-common-js expects the connection id as the empty-opcode
        // tunnel instruction before the render stream.
        sendToClient(encodeInstruction("", connectionId));
        flushPendingClientMessages();
        // Forward any render bytes that arrived in the same TCP segment.
        const consumedBytes = Buffer.byteLength(text.slice(0, consumed), "utf8");
        const remainder = preBuffer.subarray(consumedBytes);
        if (remainder.length > 0) {
          sendToClient(remainder);
        }
        preBuffer = Buffer.alloc(0);
        return;
      }
      // Any other pre-ready opcode (e.g. nop) is ignored.
    }

    // Retain unconsumed bytes for the next chunk.
    const consumedBytes = Buffer.byteLength(text.slice(0, consumed), "utf8");
    preBuffer = preBuffer.subarray(consumedBytes);
  };

  guacd.once("connect", () => {
    log("connected to guacd; selecting protocol");
    guacd.write(encodeInstruction("select", config.protocol));
  });

  guacd.on("data", (chunk) => {
    if (closed) {
      return;
    }
    if (open) {
      sendToClient(chunk);
      return;
    }
    handleHandshakeData(chunk);
  });

  ws.on("message", (message) => {
    if (closed) {
      return;
    }
    const buffer = rawDataToBuffer(message);
    if (!open) {
      pendingClientMessages.push(buffer);
      return;
    }
    guacd.write(buffer);
  });

  guacd.once("error", (error) => {
    logError(`guacd socket error: ${error.message}`);
    sendToClient(encodeInstruction("error", error.message, "519"));
    closeBoth();
  });

  guacd.once("close", () => {
    if (!closed) {
      log(`guacd connection closed${open ? "" : " before session was ready"}`);
    }
    closeBoth();
  });
  ws.once("close", closeBoth);
  ws.once("error", closeBoth);
}
