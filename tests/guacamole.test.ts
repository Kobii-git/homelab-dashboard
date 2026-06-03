import { describe, expect, it } from "vitest";
import {
  encodeInstruction,
  rewriteConnectInstruction,
  SessionStore,
  valueForArgument
} from "../src/server/guacamole.js";

describe("guacamole tunnel helpers", () => {
  it("resolves tokens by session id when token lookup fails", () => {
    const store = new SessionStore();
    const token = store.create(
      {
        protocol: "rdp",
        host: "10.0.0.10",
        port: 3389,
        displayName: "Test VM"
      },
      "history-123"
    );

    expect(store.get(token)?.host).toBe("10.0.0.10");
    expect(store.resolve("wrong-token", "history-123")?.host).toBe("10.0.0.10");
    expect(store.resolve(null, "history-123")?.host).toBe("10.0.0.10");
  });

  it("injects vault credentials into connect instructions", () => {
    const config = {
      protocol: "ssh" as const,
      host: "10.0.0.5",
      port: 22,
      displayName: "Test",
      credential: { username: "admin", password: "secret" }
    };

    const rewritten = rewriteConnectInstruction(config, ["hostname", "port", "username", "password"], {
      opcode: "connect",
      args: ["", "", "", ""]
    });

    expect(rewritten).toBe(
      encodeInstruction("connect", "10.0.0.5", "22", "admin", "secret")
    );
    expect(valueForArgument(config, "hostname")).toBe("10.0.0.5");
  });
});
