// Logical-provider registry for the Providers operations dashboard. Each entry
// GROUPS the real per-env-key cards from lib/known-settings.ts (e.g. Vobiz = 4
// keys, R2 = 5) into one operational provider, and defines how to recognise that
// provider's events in the unified stream + how to score its runtime health.
// Nothing here is invented: every provider maps to env keys that actually exist
// in KNOWN_SETTINGS, plus two intrinsic core modules (LiveKit, Database).
import { type LiveEvent, type Category, mf } from "./eventModel";

export type ProviderKind =
  | "LLM" | "STT" | "TTS" | "TELEPHONY" | "MEDIA" | "CALENDAR"
  | "MESSAGING" | "STORAGE" | "WEBHOOK" | "DATABASE";

export type ProviderDef = {
  key: string;
  label: string;
  kind: ProviderKind;
  envKeys: string[];          // keys in KNOWN_SETTINGS — "configured" = any present
  tokens: string[];           // substrings matched in provider/model/message/source
  ownsCategories?: Category[]; // categories this provider UNIQUELY owns (category-match)
  intrinsic?: boolean;        // core module present regardless of env (livekit, db)
  pipelineStage?: string;     // stage name in the global latest-call pipeline
};

// Order = rough call-flow order, used for the global pipeline row.
export const PROVIDERS: ProviderDef[] = [
  { key: "vobiz", label: "Vobiz / Telephony", kind: "TELEPHONY", pipelineStage: "SIP",
    envKeys: ["VOBIZ_SIP_DOMAIN", "VOBIZ_USERNAME", "VOBIZ_PASSWORD", "VOBIZ_OUTBOUND_NUMBER"],
    tokens: ["vobiz", "sip", "dial", "trunk", "ringing"], ownsCategories: ["SIP"] },
  { key: "livekit", label: "LiveKit", kind: "MEDIA", intrinsic: true, pipelineStage: "LIVEKIT",
    envKeys: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_WEBHOOK_SECRET", "OUTBOUND_TRUNK_ID", "INBOUND_TRUNK_ID"],
    tokens: ["livekit", "roomio", "room_connected", "room_created", "participant", "track", "worker_job",
             "audio_publish", "agent_input", "first_frame", "noise_cancellation"] },
  { key: "deepgram", label: "Deepgram (STT/Aura)", kind: "STT", pipelineStage: "STT",
    envKeys: ["DEEPGRAM_API_KEY"], tokens: ["deepgram", "nova", "aura", "keyterm", "stt_"], ownsCategories: ["STT"] },
  { key: "groq", label: "Groq", kind: "LLM", pipelineStage: "LLM",
    envKeys: ["GROQ_API_KEY"], tokens: ["groq", "gpt-oss", "llama", "qwen"] },
  { key: "google", label: "Google / Gemini", kind: "LLM", pipelineStage: "LLM",
    envKeys: ["GOOGLE_API_KEY"], tokens: ["gemini", "google"] },
  { key: "openai", label: "OpenAI", kind: "LLM", pipelineStage: "LLM",
    envKeys: ["OPENAI_API_KEY"], tokens: ["openai", "gpt-4", "gpt-3", "gpt-oss"] },
  { key: "anthropic", label: "Anthropic / Claude", kind: "LLM", pipelineStage: "LLM",
    envKeys: ["ANTHROPIC_API_KEY"], tokens: ["anthropic", "claude"] },
  { key: "calcom", label: "Cal.com / Calendar", kind: "CALENDAR", pipelineStage: "TOOLS",
    envKeys: ["CALCOM_API_KEY", "CALCOM_EVENT_TYPE_ID", "CALCOM_TIMEZONE"],
    tokens: ["calcom", "calendar", "availability", "slot", "booking", "appointment"], ownsCategories: ["BOOKING"] },
  { key: "sarvam", label: "Sarvam (STT/TTS)", kind: "TTS", pipelineStage: "TTS",
    envKeys: ["SARVAM_API_KEY"], tokens: ["sarvam", "bulbul", "saaras"] },
  { key: "gemini_tts", label: "Gemini TTS", kind: "TTS", pipelineStage: "TTS",
    envKeys: ["GOOGLE_API_KEY"], tokens: ["gemini_tts", "gemini-3", "gemini-2.5", "aoede", "kore"] },
  { key: "elevenlabs", label: "ElevenLabs (TTS)", kind: "TTS", pipelineStage: "TTS",
    envKeys: ["ELEVENLABS_API_KEY"], tokens: ["elevenlabs", "eleven"] },
  { key: "cartesia", label: "Cartesia (TTS)", kind: "TTS", pipelineStage: "TTS",
    envKeys: ["CARTESIA_API_KEY"], tokens: ["cartesia", "sonic"] },
  // Recording is self-hosted on local disk; the R2 keys remain only so LEGACY
  // cloud recordings still light the card up as configured.
  { key: "recording", label: "Call Recording (self-hosted)", kind: "STORAGE", pipelineStage: "AUDIO",
    envKeys: ["RECORDING_BACKEND", "RECORDINGS_DIR",
              "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT"],
    tokens: ["egress", "recording", "r2_", "r2 ", "storage_upload"] },
  { key: "twilio", label: "Twilio (SMS/WhatsApp)", kind: "MESSAGING",
    envKeys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_WHATSAPP_NUMBER"],
    tokens: ["twilio", "sms", "whatsapp"] },
  { key: "telegram", label: "Telegram", kind: "MESSAGING",
    envKeys: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"], tokens: ["telegram"] },
  { key: "webhook", label: "Webhooks / n8n", kind: "WEBHOOK",
    envKeys: ["N8N_WEBHOOK_URL"], tokens: ["webhook", "n8n"], ownsCategories: ["API"] },
  { key: "database", label: "Database", kind: "DATABASE", intrinsic: true,
    envKeys: [], tokens: ["prisma", "call_logged", "call_row", "db_error"], ownsCategories: ["DATABASE"] },
];

const PROVIDER_KEYS = new Set(PROVIDERS.map((p) => p.key));

export function matchProvider(def: ProviderDef, ev: LiveEvent): boolean {
  // An event that names its provider is authoritative. Without this, loose
  // tokens cross-contaminate sibling cards that share a vendor — e.g. "gemini"
  // would pull Gemini TTS events onto the Google LLM card.
  const explicit = mf(ev.meta, "provider").toLowerCase();
  if (explicit && PROVIDER_KEYS.has(explicit)) return explicit === def.key;

  const hay = `${explicit} ${mf(ev.meta, "model")} ${mf(ev.meta, "tts_provider")} ${ev.message} ${ev.source}`.toLowerCase();
  if (def.tokens.some((t) => hay.includes(t))) return true;
  if (def.ownsCategories && def.ownsCategories.includes(ev.category)) return true;
  return false;
}

export type ProviderStatus = "healthy" | "warning" | "failed" | "disconnected" | "none" | "disabled";

export type ProviderMetrics = {
  events: LiveEvent[];
  requests: number;
  success: number;
  failed: number;
  successRate: number | null;
  avgLatency: number | null;
  p50: number | null;
  p95: number | null;
  lastActivity: number | null;
  lastSuccess: number | null;
  lastErrorAt: number | null;
  lastError: LiveEvent | null;
  activeCalls: string[];
  fallbackUsed: boolean;
  cooldown: boolean;
  status: ProviderStatus;
};

const REQUEST_RE = /request_started|_started|dialing|job_received|route_selected|connect_started|send_requested|availability_check|booking_started|egress_start|publish_started|runtime_config|call_requested/i;

function pct(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Derive this provider's runtime health + metrics from the CURRENT-SESSION events.
// configured=false → "disabled" when there's also no activity. All numbers come
// from real events; empty → status "none" (NO ACTIVITY), never a fake green.
export function deriveProviderMetrics(def: ProviderDef, all: LiveEvent[], configured: boolean): ProviderMetrics {
  const events = all.filter((e) => matchProvider(def, e));
  const lats = events
    .map((e) => Number(mf(e.meta, "latency_ms", "total_ms", "elapsed_ms", "first_token_to_first_audio_ms")))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const errs = events.filter((e) => e.status === "ERROR" || e.status === "CRITICAL");
  const succ = events.filter((e) => e.status === "SUCCESS");
  const requests = events.filter((e) => REQUEST_RE.test(e.message)).length;
  const lastActivity = events.length ? events[events.length - 1].ts : null;
  const lastSuccess = succ.length ? succ[succ.length - 1].ts : null;
  const lastError = errs.length ? errs[errs.length - 1] : null;
  const lastErrorAt = lastError ? lastError.ts : null;
  const activeCalls = Array.from(new Set(events.map((e) => mf(e.meta, "call_id", "room")).filter(Boolean)));
  const cooldown = events.some((e) => /cooldown|rate_limit|429|quota|credits/i.test(e.message) && e.ts > (lastSuccess ?? 0));
  const fallbackUsed = events.some((e) => /fallback|failover|recovered_by_fallback/i.test(e.message));

  let status: ProviderStatus;
  if (events.length === 0) status = configured ? "none" : "disabled";
  else if (lastErrorAt && (!lastSuccess || lastErrorAt >= lastSuccess)) status = "failed";
  else if (cooldown) status = "warning";
  else if (lastSuccess) status = "healthy";
  else status = "warning"; // activity but nothing confirmed success/fail yet

  const avgLatency = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  return {
    events, requests, success: succ.length, failed: errs.length,
    successRate: events.length ? Math.round((succ.length / Math.max(1, succ.length + errs.length)) * 100) : null,
    avgLatency, p50: pct(lats, 50), p95: pct(lats, 95),
    lastActivity, lastSuccess, lastErrorAt, lastError, activeCalls, fallbackUsed, cooldown, status,
  };
}
