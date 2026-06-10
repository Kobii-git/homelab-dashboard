import crypto from "node:crypto";

export type EncryptedPayload = {
  encryptedBlob: string;
  iv: string;
  authTag: string;
};

function requireVaultKey(vaultKey = process.env.HOMELAB_VAULT_KEY): string {
  if (!vaultKey || vaultKey.length < 16) {
    throw new Error("HOMELAB_VAULT_KEY must be set to at least 16 characters");
  }

  return vaultKey;
}

function deriveKey(vaultKey?: string): Buffer {
  return crypto.createHash("sha256").update(requireVaultKey(vaultKey)).digest();
}

export function encryptJson(value: Record<string, unknown>, vaultKey?: string): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(vaultKey), iv);
  cipher.setAAD(Buffer.from("homelab-dashboard:v1", "utf8"));

  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedBlob: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
}

export function decryptJson<T extends Record<string, unknown>>(
  encrypted: EncryptedPayload,
  vaultKey?: string
): T {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(vaultKey),
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAAD(Buffer.from("homelab-dashboard:v1", "utf8"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedBlob, "base64")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8")) as T;
}
