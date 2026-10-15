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
