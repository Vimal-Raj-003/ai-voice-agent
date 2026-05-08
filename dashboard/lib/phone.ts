/**
 * Normalize a phone string to E.164. Accepts inputs like "9876543210",
 * "+91 98765 43210", "98765-43210". Defaults to +91 country code when
 * none present. Returns null on failure.
 */
export function normalizeE164(raw: string, defaultCountry = "+91"): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  const numberWithoutCountry = digits.replace(/^0+/, "");
  const candidate = `${defaultCountry}${numberWithoutCountry}`;
  return /^\+\d{8,15}$/.test(candidate) ? candidate : null;
}
