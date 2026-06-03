import { EventEmitter } from "node:events";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  encodeInstruction,
  wireGuacamoleTunnel,
  type GuacamoleSessionConfig
} from "../src/server/guacamole.js";

/** Minimal stand-in for the `ws` WebSocket the tunnel talks to. */
class FakeWebSocket extends EventEmitter {
  readyState = 1;
  readonly OPEN = 1;
  readonly sent: Buffer[] = [];

  send(data: unknown): void {
    this.sent.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  receivedText(): string {
    return Buffer.concat(this.sent).toString("utf8");
  }
}

/** Pull complete Guacamole instructions out of an accumulating buffer. */
function drainInstructions(state: { buf: string }): string[][] {
  const out: string[][] = [];
  for (;;) {
    const elements: string[] = [];
    let i = 0;
    for (;;) {
      const dot = state.buf.indexOf(".", i);
      if (dot === -1) return out;
      const len = Number(state.buf.slice(i, dot));
      const start = dot + 1;
      const end = start + len;
      if (state.buf.length < end + 1) return out;
      elements.push(state.buf.slice(start, end));
      const terminator = state.buf[end];
      i = end + 1;
      if (terminator === ";") break;
    }
    out.push(elements);
    state.buf = state.buf.slice(i);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("wireGuacamoleTunnel (server-driven handshake)", () => {
  let guacd: net.Server | undefined;

  afterEach(async () => {
    if (guacd) {
      await new Promise<void>((resolve) => guacd!.close(() => resolve()));
      guacd = undefined;
    }
  });

  it("drives the full guacd handshake, injects vault creds, and relays both ways", async () => {
    const received = { select: [] as string[], connect: [] as string[], clientInput: "" };

    guacd = net.createServer((sock) => {
      const state = { buf: "" };
      sock.on("data", (chunk) => {
        state.buf += chunk.toString("utf8");
        for (const [opcode, ...args] of drainInstructions(state)) {
          if (opcode === "select") {
            received.select = [opcode, ...args];
            // guacd offers the version pseudo-arg plus the real params
            sock.write(encodeInstruction("args", "VERSION_1_5_0", "hostname", "port", "username", "password"));
          } else if (opcode === "connect") {
            received.connect = [opcode, ...args];
            sock.write(encodeInstruction("ready", "$node-test"));
            sock.write(encodeInstruction("sync", "0"));
          } else if (opcode === "key") {
            received.clientInput += args.join(",");
          }
        }
      });
    });

    const port: number = await new Promise((resolve) => {
      guacd!.listen(0, "127.0.0.1", () => resolve((guacd!.address() as net.AddressInfo).port));
    });

    const config: GuacamoleSessionConfig = {
      protocol: "ssh",
      host: "10.0.0.5",
      port: 22,
      displayName: "Test SSH",
      credential: { username: "admin", password: "secret" }
    };

    const ws = new FakeWebSocket();
    wireGuacamoleTunnel(ws as never, config, { host: "127.0.0.1", port });

    // Allow the handshake exchange to complete.
    for (let i = 0; i < 50 && received.connect.length === 0; i += 1) {
      await wait(10);
    }

    // 1. Server initiated the handshake with the correct protocol.
    expect(received.select).toEqual(["select", "ssh"]);

    // 2. Server answered `args` with `connect`, echoing the version and
    //    injecting the vault credentials + resolved host/port.
    expect(received.connect).toEqual(["connect", "VERSION_1_5_0", "10.0.0.5", "22", "admin", "secret"]);

    // 3. The render stream (ready + sync) reached the browser WebSocket.
    for (let i = 0; i < 50 && !ws.receivedText().includes("sync"); i += 1) {
      await wait(10);
    }
    expect(ws.receivedText()).toContain("ready");
    expect(ws.receivedText()).toContain("sync");

    // 4. Post-handshake client input is relayed through to guacd.
    ws.emit("message", Buffer.from(encodeInstruction("key", "65", "1")));
    for (let i = 0; i < 50 && received.clientInput === ""; i += 1) {
      await wait(10);
    }
    expect(received.clientInput).toContain("65");

    ws.close();
  });
});
