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

function encodeInstruction(opcode: string, ...args: Array<string | number | null | undefined>): string {
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

function valueForArgument(config: GuacamoleSessionConfig, argument: string): string {
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

export function wireGuacamoleTunnel(
  ws: WebSocket,
  config: GuacamoleSessionConfig,
  options: { host: string; port: number }
): void {
  const guacd = net.createConnection({ host: options.host, port: options.port });
  let guacdReady = false;
  let closed = false;

  const closeBoth = () => {
    if (closed) {
      return;
    }

    closed = true;
    guacd.destroy();
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  };

  const guacdParser = new InstructionParser((instruction) => {
    if (instruction.opcode === "args") {
      guacd.write(encodeInstruction("size", 1280, 720, 96));
      guacd.write(encodeInstruction("audio", "audio/L16"));
      guacd.write(encodeInstruction("video"));
      guacd.write(encodeInstruction("image", "image/png", "image/jpeg", "image/webp"));
      guacd.write(encodeInstruction("timezone", process.env.TZ ?? "UTC"));
      guacd.write(
        encodeInstruction("connect", ...instruction.args.map((arg) => valueForArgument(config, arg)))
      );
      return;
    }

    if (instruction.opcode === "ready") {
      guacdReady = true;
      ws.send(encodeInstruction("ready", ...instruction.args));
      return;
    }

    if (instruction.opcode === "error") {
      ws.send(encodeInstruction("error", ...instruction.args));
      closeBoth();
    }
  });

  ws.on("message", (message) => {
    if (closed) {
      return;
    }
    guacd.write(rawDataToBuffer(message));
  });

  guacd.on("data", (chunk) => {
    if (closed) {
      return;
    }

    if (guacdReady) {
      ws.send(chunk);
      return;
    }

    guacdParser.push(chunk.toString("utf8"));
  });

  guacd.once("error", (error) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(encodeInstruction("error", "520", error.message));
    }
    closeBoth();
  });

  guacd.once("close", closeBoth);
  ws.once("close", closeBoth);
  ws.once("error", closeBoth);
}
