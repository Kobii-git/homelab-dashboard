import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "../src/server/vault";

describe("credential vault", () => {
  it("round-trips credentials with AES-GCM", () => {
    const encrypted = encryptCredential(
      {
        username: "admin",
        password: "secret",
        domain: "LAB"
      },
      "unit-test-vault-key"
    );

    expect(encrypted.encryptedBlob).not.toContain("secret");
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();

    const decrypted = decryptCredential(encrypted, "unit-test-vault-key");
    expect(decrypted).toEqual({
      username: "admin",
      password: "secret",
      domain: "LAB"
    });
  });

  it("rejects the wrong vault key", () => {
    const encrypted = encryptCredential({ password: "secret" }, "unit-test-vault-key");
    expect(() => decryptCredential(encrypted, "another-vault-key")).toThrow();
  });
});
