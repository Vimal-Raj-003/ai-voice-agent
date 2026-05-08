import crypto from "node:crypto";

const PREFIX = "jjv_";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(24).toString("base64url");
  const key = `${PREFIX}${random}`;
  const prefix = key.slice(0, 12);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
