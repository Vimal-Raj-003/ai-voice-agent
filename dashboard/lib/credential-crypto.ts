// AES-256-GCM for BYOK provider credentials.
//
// Why not reuse lib/api-key.ts: that hashes (one-way) a token callers present
// TO us. A provider credential has to travel the other way — the worker must
// present the real key to Deepgram/Sarvam/Murf — so it must be recoverable.
// Hashing is the right answer for one and the wrong answer for the other.
//
// Wire format is deliberately language-neutral so voice-service/credential_crypto.py
// can decrypt exactly the same string:
//
//     v1:<base64 iv>:<base64 ciphertext>:<base64 authTag>
//
// GCM (not CBC) so the tag detects tampering: a corrupted row fails loudly
// instead of handing a garbage key to a provider.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for

/**
 * The 32-byte key, from CREDENTIAL_ENCRYPTION_KEY.
 *
 * Accepts base64 (preferred, generate with `openssl rand -base64 32`) or a
 * passphrase, which is SHA-256'd to 32 bytes so a human-typed value still
 * works. Throws rather than falling back to a default key — a hardcoded
 * fallback would silently make every tenant's credentials readable.
 */
function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set — provider credentials cannot be " +
        "stored or read. Generate one with: openssl rand -base64 32",
    );
  }
  // A 32-byte base64 value decodes to exactly 32 bytes; anything else is
  // treated as a passphrase.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(raw, "utf8").digest();
}

/** True when a key is configured, so callers can degrade instead of throwing. */
export function encryptionAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    ct.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("credential ciphertext is malformed or of a newer version");
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Last 4 characters, for display. Never return more: the hint is rendered in
 * the browser, so it must not be enough to reconstruct the key.
 */
export function secretHint(plaintext: string): string {
  const t = plaintext.trim();
  return t.length <= 4 ? "••••" : t.slice(-4);
}
