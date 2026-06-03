import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/server/guacamole.js";

describe("SessionStore", () => {
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
});
