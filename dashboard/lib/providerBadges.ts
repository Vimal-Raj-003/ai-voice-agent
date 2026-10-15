// Plain-English badges shown next to each provider/model.
//
// For STT and TTS, voice-service/provider_registry.py is the SOURCE OF TRUTH —
// the assistant dropdowns render its `badges` directly. The STT/TTS rows here
// are a static mirror for the ops cards, which also cover providers the speech
// registry does not know about (LiveKit, Vobiz, the database) and so still need
// a local map. Change the registry first, then mirror it here.
//
// Two different kinds of statement live in this file, and they must not be
// mixed in one badge row:
//
//   * RECOMMENDATIONS (Excellent / Low Cost / Fast / Best for Indian Languages)
//     — editorial advice from published pricing, language suitability and
//     reputation. Shown whether or not a key exists, because that is what a
//     customer uses to decide which provider to buy. Not usage cost.
//   * CONNECTION STATUS (Connected / Not Configured) — rendered as its own
//     element (ProviderStatusChip), never inside the recommendation row.
//
// `evidence` is surfaced only as a tooltip; HTTP codes and error strings must
// never sit beside a provider name.

export type BadgeTone = "good" | "warn" | "bad" | "info";

export type Badge = {
  label: string;      // end-user wording, no jargon
  tone: BadgeTone;
  evidence: string;   // tooltip: what was actually measured
};

const EXCELLENT: Badge = {
  label: "Excellent", tone: "good",
  evidence: "Overall output quality for voice calls. Recommended setting.",
};
const PRICE_NOTE =
  "Based on the vendor's published list price, not your usage.";
const QUALITY_NOTE = "Overall output quality for voice calls.";
const NOT_CONFIGURED: Badge = {
  label: "Not configured", tone: "info",
  evidence: "No API key is set, so this provider cannot be used yet. Add its key in Settings.",
};

/** provider key (lowercase) or `provider:model` for model-specific verdicts. */
export const PROVIDER_BADGES: Record<string, Badge[]> = {
  // ── LLM ──────────────────────────────────────────────────────────────────
  "groq:openai/gpt-oss-20b": [
    EXCELLENT,
    { label: "Low cost", tone: "good",
      evidence: "About $0.0000155 per reply in testing — roughly 11x cheaper than Qwen for the same question." },
  ],
  "groq:qwen/qwen3.8-27b": [
    { label: "Good", tone: "warn",
      evidence: "Answers correctly, but invented a false detail when asked about an unfamiliar topic." },
    { label: "Higher cost", tone: "warn",
      evidence: "About $0.000171 per reply — roughly 11x the cost of GPT-OSS 20B." },
  ],
  groq: [EXCELLENT, { label: "Low cost", tone: "good",
    evidence: "Fastest verified LLM in testing, at the lowest measured cost per reply." }],
  // The providers registry calls this "google"; the LLM dropdown calls it
  // "gemini". Both must resolve to the same verdict.
  gemini: [{ label: "Billing required", tone: "bad",
    evidence: "The account's prepayment credits are depleted, so requests are refused. Top up to re-enable." }],
  google: [{ label: "Billing required", tone: "bad",
    evidence: "The account's prepayment credits are depleted, so requests are refused. Top up to re-enable." }],
  gemini_tts: [{ label: "Billing required", tone: "bad",
    evidence: "Voice generation is refused because the account's prepayment credits are depleted." }],
  openai: [NOT_CONFIGURED],
  anthropic: [
    { label: "Good value", tone: "good",
      evidence: "Published pricing is among the lowest for its quality tier, but we could not test it without a key." },
    NOT_CONFIGURED,
  ],
  openrouter: [NOT_CONFIGURED],
  custom: [{ label: "Needs setup", tone: "info",
    evidence: "No endpoint address has been configured for a custom provider." }],

  // ── STT / TTS ─────────────────────────────────────────────────────────────
  // SOURCE OF TRUTH is voice-service/provider_registry.py; the assistant
  // dropdowns render `badges` straight from it. The rows below are a static
  // mirror for the ops cards, which also show providers the speech registry
  // does not cover (LiveKit, Vobiz, the database) and so cannot drop this map.
  // They use the SAME recommendation vocabulary, and they carry no credential
  // state: connection status is rendered as its own element everywhere now.
  "stt:sarvam": [
    EXCELLENT,
    { label: "Very Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Best for Indian Languages", tone: "good",
      evidence: "Accurate Tamil in proper Tamil script, about 5x faster than Deepgram in testing." },
  ],
  "stt:deepgram": [
    EXCELLENT,
    { label: "Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Multilingual", tone: "info",
      evidence: "Nova-3 multilingual. Note: Tamil comes back in the wrong script." },
  ],
  "stt:openai": [
    { label: "Good", tone: "good", evidence: QUALITY_NOTE },
    { label: "Very Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Budget", tone: "info", evidence: "Mini Transcribe tier." },
  ],
  "stt:elevenlabs": [
    EXCELLENT,
    { label: "Medium Cost", tone: "info", evidence: PRICE_NOTE },
    { label: "Multilingual", tone: "info", evidence: "Scribe covers many languages." },
  ],
  "stt:google": [
    { label: "Good", tone: "good", evidence: QUALITY_NOTE },
    { label: "Medium Cost", tone: "info", evidence: PRICE_NOTE },
    { label: "Multilingual", tone: "info", evidence: "Broad language coverage." },
  ],
  "stt:cartesia": [
    { label: "Good", tone: "good", evidence: QUALITY_NOTE },
    { label: "Medium Cost", tone: "info", evidence: PRICE_NOTE },
    { label: "Fast", tone: "info", evidence: "Low-latency streaming." },
  ],

  "tts:sarvam": [
    EXCELLENT,
    { label: "Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Best for Indian Languages", tone: "good",
      evidence: "Natural speech in English, Tamil, Telugu and Malayalam with a native Indian voice." },
  ],
  "tts:deepgram": [
    { label: "Good", tone: "good", evidence: QUALITY_NOTE },
    { label: "Medium Cost", tone: "info", evidence: PRICE_NOTE },
    { label: "Fast", tone: "info",
      evidence: "Aura-2. Note: reads Tamil text with an English voice." },
  ],
  "tts:openai": [
    { label: "Good", tone: "good", evidence: QUALITY_NOTE },
    { label: "Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Multilingual", tone: "info", evidence: "Covers many languages." },
  ],
  "tts:elevenlabs": [
    EXCELLENT,
    { label: "High Cost", tone: "warn", evidence: PRICE_NOTE },
    { label: "Premium", tone: "info", evidence: "Best-regarded voice quality tier." },
  ],
  "tts:cartesia": [
    EXCELLENT,
    { label: "Medium Cost", tone: "info", evidence: PRICE_NOTE },
    { label: "Very Fast", tone: "info", evidence: "Built for low-latency speech." },
  ],
  "tts:gemini": [
    EXCELLENT,
    { label: "Very Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Fast", tone: "info", evidence: "Flash-Lite tier." },
  ],
  "tts:rumik": [
    EXCELLENT,
    { label: "Very Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Indian Languages", tone: "good", evidence: "Built for Indic code-switching." },
  ],
  "tts:murf": [
    EXCELLENT,
    { label: "Low Cost", tone: "good", evidence: PRICE_NOTE },
    { label: "Fast", tone: "info", evidence: "Falcon is their streaming tier." },
  ],

  // ── Infrastructure ───────────────────────────────────────────────────────
  livekit:   [{ label: "Connected", tone: "good", evidence: "Live connection verified." },
              { label: "Recommended", tone: "good", evidence: "Carries the call audio; no change needed." }],
  vobiz:     [{ label: "Connected", tone: "good", evidence: "Phone line verified and ready to place calls." },
              { label: "Recommended", tone: "good", evidence: "Working phone connection; no change needed." }],
  recording: [{ label: "Connected", tone: "good", evidence: "Recordings save to this server and play back correctly." }],
  database:  [{ label: "Connected", tone: "good", evidence: "Database responding normally." }],
  calcom:    [NOT_CONFIGURED],
  twilio:    [NOT_CONFIGURED],
  telegram:  [NOT_CONFIGURED],
  webhook:   [NOT_CONFIGURED],
  elevenlabs: [NOT_CONFIGURED],
  cartesia:   [NOT_CONFIGURED],
  deepgram:  [{ label: "Good for English", tone: "good", evidence: "Accurate on English speech." },
              { label: "Weak for Tamil", tone: "bad",
                evidence: "Tamil comes back in the wrong alphabet without reporting an error." }],
  sarvam:    [EXCELLENT, { label: "Best for Indian languages", tone: "good",
                evidence: "Accurate Tamil, Telugu and Malayalam in their own scripts." }],
};

/**
 * Badges for a provider, optionally narrowed by model and category.
 * Looks for `category:provider:model`, then `provider:model`, then
 * `category:provider`, then `provider`. Max 3 are ever returned.
 */
export function badgesFor(provider: string, model?: string | null, category?: string): Badge[] {
  const p = (provider || "").toLowerCase();
  const m = (model || "").toLowerCase();
  const c = (category || "").toLowerCase();
  const keys = [c && m && `${c}:${p}:${m}`, m && `${p}:${m}`, c && `${c}:${p}`, p].filter(Boolean) as string[];
  for (const k of keys) {
    const hit = PROVIDER_BADGES[k];
    if (hit) return hit.slice(0, 3);
  }
  return [];
}

export const BADGE_CLASS: Record<BadgeTone, string> = {
  good: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/20",
  warn: "bg-amber-500/15 text-amber-300 ring-amber-400/20",
  bad:  "bg-red-500/15 text-red-300 ring-red-400/20",
  info: "bg-white/[0.06] text-gray-400 ring-white/10",
};
