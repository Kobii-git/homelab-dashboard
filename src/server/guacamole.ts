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

  const common: Record<string, string> = {
    hostname: config.host,
    port: String(config.port),
    username,
    password,
    domain: credential.domain ?? "",
    "ignore-cert": "true",
    security: "any",
    "server-layout": "en-us-qwerty",
    "color-depth": "32",
    "resize-method": "display-update",
    "enable-wallpaper": "true",
    "enable-theming": "true",
    "enable-font-smoothing": "true",
    "enable-full-window-drag": "true",
    "enable-desktop-composition": "true",
    "enable-menu-animations": "true",
    "terminal-type": "xterm-256color",
    "font-size": "12",
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
 * Build the value to send for a single `connect` argument during the
 * server-driven guacd handshake. Version-negotiation pseudo-arguments
 * (e.g. "VERSION_1_5_0") are echoed back unchanged so guacd knows which
 * protocol version we support; everything else is resolved from the
 * session config (host, port, vault credentials, display options).
 */
function connectValueForArg(config: GuacamoleSessionConfig, argName: string): string {
  if (argName.startsWith("VERSION_")) {
    return argName;
  }
  return valueForArgument(config, argName);
}

const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * Bridge a browser WebSocket (guacamole-common-js) to a guacd TCP socket.
 *
 * guacamole-common-js does NOT perform the guacd handshake itself — calling
 * `client.connect()` only opens the tunnel and waits. The SERVER must drive
 * the full handshake with guacd, then relay the rendered session both ways:
 *
 *   server -> guacd : select,<protocol>
 *   guacd  -> server: args,<version>,<param>,...
 *   server -> guacd : size / audio / video / image
 *   server -> guacd : connect,<value per param>   (vault creds injected here)
 *   guacd  -> server: ready,<id>                  (then render stream)
 *
 * Only the initial `args` instruction from guacd is parsed; everything after
 * the handshake is forwarded as raw bytes in both directions to avoid the
 * byte/char framing pitfalls of re-encoding the high-volume render stream.
 */
export function wireGuacamoleTunnel(
  ws: WebSocket,
  config: GuacamoleSessionConfig,
  options: { host: string; port: number }
): void {
  const guacd = net.createConnection({ host: options.host, port: options.port });
  guacd.setNoDelay(true);

  let guacdConnected = false;
  let handshakeDone = false;
  let closed = false;
  const pendingClientMessages: Buffer[] = [];

  const wsOpen = () => ws.readyState === ws.OPEN;

  const handshakeTimer = setTimeout(() => {
    if (!handshakeDone) {
      if (wsOpen()) {
        ws.send(encodeInstruction("error", "guacd handshake timed out", "519"));
      }
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
    // Declare what the proxy will relay. Audio/video are disabled (empty);
    // images cover what the browser display can render.
    guacd.write(encodeInstruction("size", 1024, 768, 96));
    guacd.write(encodeInstruction("audio"));
    guacd.write(encodeInstruction("video"));
    guacd.write(encodeInstruction("image", "image/png", "image/jpeg", "image/webp"));

    const values = argNames.map((name) => connectValueForArg(config, name));
    guacd.write(encodeInstruction("connect", ...values));

    handshakeDone = true;
    clearTimeout(handshakeTimer);
    flushPendingClientMessages();
  };

  // Parses only the pre-`ready` handshake traffic from guacd. Once the `args`
  // instruction is seen we send the reply and switch to raw passthrough.
  const handshakeParser = new InstructionParser((instruction) => {
    if (handshakeDone) {
      return;
    }
    if (instruction.opcode === "args") {
      sendHandshakeReply(instruction.args);
      return;
    }
    if (instruction.opcode === "error") {
      if (wsOpen()) {
        ws.send(encodeInstruction("error", ...instruction.args));
      }
      closeBoth();
    }
  });

  guacd.once("connect", () => {
    guacdConnected = true;
    guacd.write(encodeInstruction("select", config.protocol));
  });

  guacd.on("data", (chunk) => {
    if (closed) {
      return;
    }
    if (handshakeDone) {
      if (wsOpen()) {
        ws.send(chunk);
      }
      return;
    }
    // Pre-handshake guacd output is ASCII (args/error); parse to drive the
    // handshake. guacd does not stream render data before we send `connect`,
    // so there is nothing to lose to the parser's internal buffer here.
    handshakeParser.push(chunk.toString("utf8"));
  });

  ws.on("message", (message) => {
    if (closed) {
      return;
    }
    const buffer = rawDataToBuffer(message);
    if (!guacdConnected || !handshakeDone) {
      pendingClientMessages.push(buffer);
      return;
    }
    guacd.write(buffer);
  });

  guacd.once("error", (error) => {
    if (wsOpen()) {
      ws.send(encodeInstruction("error", error.message, "519"));
    }
    closeBoth();
  });

  guacd.once("close", closeBoth);
  ws.once("close", closeBoth);
  ws.once("error", closeBoth);
}
