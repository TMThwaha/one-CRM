import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "./config";

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the database, e.g. TOTP seeds.
 * The key comes from APP_ENCRYPTION_KEY. Outside production a fixed, PUBLIC development key is
 * used when none is set - it protects nothing and exists only so local runs work.
 */
function key(): Buffer {
  const cfg = getConfig();
  if (cfg.APP_ENCRYPTION_KEY) {
    const k = Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64");
    if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes");
    return k;
  }
  if (cfg.NODE_ENV === "production" && cfg.ALLOW_EMBEDDED_DB !== "true") {
    throw new Error("APP_ENCRYPTION_KEY is required in production");
  }
  return createHash("sha256").update("onecrm-insecure-development-key").digest();
}

/** Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
