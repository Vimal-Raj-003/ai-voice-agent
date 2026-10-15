// Shared phone normalization. India-default: a bare 10-digit mobile starting
// 6/7/8/9 is assumed Indian and stored as +91XXXXXXXXXX. Numbers that already
// carry a country code (leading +) are kept as-is; non-Indian numbers without a
// country code cannot be inferred and are flagged invalid (we never invent a
// country code for them). Pure/isomorphic — safe to import on client or server.

export type NormalizedPhone = {
  e164: string | null;
  assumedIndia: boolean;
  reason?: string;
};

export function normalizePhone(raw: string): NormalizedPhone {
  // 3. strip harmless formatting (spaces, hyphens, parentheses, dots)
  const cleaned = (raw ?? "").trim().replace(/[\s()\-.]/g, "");
  if (!cleaned) return { e164: null, assumedIndia: false, reason: "missing phone" };

  // 1 / 9. already has a country code → validate E.164, keep as-is
  if (cleaned.startsWith("+")) {
    return /^\+\d{8,15}$/.test(cleaned)
      ? { e164: cleaned, assumedIndia: false }
      : { e164: null, assumedIndia: false, reason: "invalid E.164 phone" };
  }

  if (!/^\d+$/.test(cleaned)) {
    return { e164: null, assumedIndia: false, reason: "contains non-numeric characters" };
  }

  // 1. "91" + valid 10-digit Indian mobile → +91XXXXXXXXXX (country code present)
  if (cleaned.length === 12 && cleaned.startsWith("91") && /^[6-9]/.test(cleaned.slice(2))) {
    return { e164: "+" + cleaned, assumedIndia: false };
  }

  // 2. bare 10-digit Indian mobile starting 6/7/8/9 → assume India
  if (cleaned.length === 10) {
    if (/^[6-9]/.test(cleaned)) {
      return { e164: "+91" + cleaned, assumedIndia: true };
    }
    // 4. 10 digits but not a valid Indian mobile prefix → invalid
    return { e164: null, assumedIndia: false, reason: "invalid Indian mobile prefix (must start 6-9)" };
  }

  // 4. too short / too long and not inferable, and no country code → flag
  return { e164: null, assumedIndia: false, reason: "missing country code (+)" };
}
