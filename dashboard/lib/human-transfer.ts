// Human call forwarding: the category set and number validation.
//
// Lives here rather than in the assistants `actions.ts` because that file is
// "use server" — a Server Actions module may only export ASYNC functions, so a
// plain `export function isE164` there fails the whole module to compile (and
// took the login page down with it). Keeping it in a neutral lib also means the
// form component and the server action validate against the SAME rules instead
// of each carrying their own copy of the regex.

/** The four supported categories. The assistant picks one of these names; the
 *  worker resolves the configured number. Matches the CHECK constraint on
 *  human_transfer_targets.category and HUMAN_TRANSFER_CATEGORIES in db.py. */
export const TRANSFER_CATEGORIES = [
  { category: "software", label: "Software", hint: "app, API, bugs, technical issues" },
  { category: "marketing", label: "Marketing", hint: "ads, leads, SEO, social reach" },
  { category: "content", label: "Content", hint: "video, design, writing, posts" },
  { category: "other", label: "Other / General", hint: "anything else — also the fallback" },
] as const;

export type TransferCategory = (typeof TRANSFER_CATEGORIES)[number]["category"];

/**
 * Strict E.164: a leading +, a country digit 1-9, then 7-14 more digits.
 *
 * Deliberately strict — a number that is merely "probably fine" becomes a
 * failed transfer in the middle of a real call, which the caller experiences
 * as the assistant breaking its promise.
 */
export const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isE164(v: string): boolean {
  return E164_RE.test((v ?? "").trim());
}

export type ExtraTransferPerson = {
  id: string; category: TransferCategory; label: string; phoneE164: string | null;
  enabled: boolean; priority: number;
};
export function extraTransferPeople(metadata: unknown): ExtraTransferPerson[] {
  const rows = (metadata as {humanTransferPeople?: unknown})?.humanTransferPeople;
  return Array.isArray(rows) ? rows.filter((row): row is ExtraTransferPerson =>
    !!row && /^person_[a-f0-9-]{36}$/.test(row.id) && TRANSFER_CATEGORIES.some(c => c.category === row.category)) : [];
}

export function withTransferPeople(metadata: unknown, form: FormData):Record<string,unknown> {
  const current = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string,unknown> : {};
  if (!form.has("transferExtraIds")) return current;
  const ids: unknown = JSON.parse(String(form.get("transferExtraIds")));
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error("Invalid forwarding people. Reload and try again.");
  const people: ExtraTransferPerson[] = ids.map((id: unknown) => {
    if (typeof id !== "string" || !/^person_[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid forwarding person.");
    const category = String(form.get(`transfer_${id}_intent`) || "other") as TransferCategory;
    const label = String(form.get(`transfer_${id}_label`) || "").trim().slice(0, 100);
    const phone = String(form.get(`transfer_${id}_phone`) || "").trim();
    const enabled = form.get(`transfer_${id}_enabled`) === "on";
    if (!TRANSFER_CATEGORIES.some(c => c.category === category) || !label) throw new Error("Give each forwarding person a name and team.");
    if ((phone && !isE164(phone)) || (enabled && !phone)) throw new Error(`${label}: enter a valid phone number with country code.`);
    const priority = Number(form.get(`transfer_${id}_priority`) ?? 100);
    if (!Number.isSafeInteger(priority)) throw new Error("Invalid forwarding priority.");
    return {id, category, label, phoneE164: phone || null, enabled, priority};
  });
  return {...current, humanTransferPeople: people};
}
