import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/server/vault";

describe("JSON encryption vault", () => {
  it("round-trips JSON data with AES-GCM", () => {
    const data = {
      username: "admin",
      password: "secret",
      domain: "LAB"
    };
    const encrypted = encryptJson(data, "unit-test-vault-key-at-least-16-chars");

    expect(encrypted.encryptedBlob).not.toContain("secret");
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();

    const decrypted = decryptJson<typeof data>(encrypted, "unit-test-vault-key-at-least-16-chars");
    expect(decrypted).toEqual(data);
  });

  it("rejects the wrong vault key", () => {
    const encrypted = encryptJson({ password: "secret" }, "unit-test-vault-key-at-least-16-chars");
    expect(() => decryptJson(encrypted, "another-vault-key-at-least-16-chars")).toThrow();
  });
});
