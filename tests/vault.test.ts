import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/server/vault";

describe("JSON encryption helpers", () => {
  it("round-trips JSON data with AES-GCM", () => {
    const data = {
      url: "https://example.com/webhook",
      token: "secret",
      method: "POST"
    };
    const encrypted = encryptJson(data, "unit-test-vault-key-at-least-16-chars");

    expect(encrypted.encryptedBlob).not.toContain("secret");
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();

    const decrypted = decryptJson<typeof data>(encrypted, "unit-test-vault-key-at-least-16-chars");
    expect(decrypted).toEqual(data);
  });

  it("rejects the wrong encryption key", () => {
    const encrypted = encryptJson({ token: "secret" }, "unit-test-vault-key-at-least-16-chars");
    expect(() => decryptJson(encrypted, "another-vault-key-at-least-16-chars")).toThrow();
  });
});
