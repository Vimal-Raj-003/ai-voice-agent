// Pure (no "use client") normalized-event model shared by the Live Logs console,
// the useLiveEvents hook, the provider registry and the Providers page. Keeping
// it free of React/client code lets server components import the types + the
// provider grouping without pulling in the browser-only stream hook.

export type Status = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";
export type Category =
  | "UI" | "CAMPAIGN" | "CALL" | "SIP" | "STT" | "LLM" | "TTS"
  | "AUDIO" | "TOOL" | "BOOKING" | "API" | "DATABASE" | "WORKER"
  | "SYSTEM" | "ERROR";

export type LiveEvent = {
  id: string;            // stable UNIQUE fingerprint (also the React key)
  source: string;
  level: string;
  status: Status;
  message: string;
  detail?: string;
  timestamp: string;
  ts: number;
  category: Category;
  meta: Record<string, unknown> | null;
  synthetic?: boolean;
};

const FINE_SOURCE = new Set<string>(["UI", "CAMPAIGN", "CALL", "SIP", "STT", "LLM", "TTS", "AUDIO", "TOOL", "BOOKING", "DATABASE"]);

export function parseMeta(detail?: string): Record<string, unknown> | null {
  if (!detail) return null;
  try { const o = JSON.parse(detail); return o && typeof o === "object" ? o : null; } catch { return null; }
}

export function mf(meta: Record<string, unknown> | null, ...keys: string[]): string {
  if (!meta) return "";
  for (const k of keys) { const v = meta[k]; if (v != null && v !== "") return String(v); }
  return "";
}

export function categorize(source: string, message: string, level: string): Category {
  const s = (source || "").toUpperCase();
  if (FINE_SOURCE.has(s)) return s as Category;
  const m = (message || "").toLowerCase();
  if (s === "DATABASE" || m.includes("prisma") || m.includes("db_error") || m.includes("call_logged") || m.includes("call_row")) return "DATABASE";
  if (m.includes("campaign") || m.includes("reminder")) return "CAMPAIGN";
  if (m.includes("book_appointment") || m.includes("booking") || m.includes("calcom") || m.includes("calendar") || m.includes("availability") || m.includes("appointment") || m.includes("slot")) return "BOOKING";
  if (m.includes("tool") || m.includes("transfer_to_human") || m.includes("remember_details") || m.includes("lookup_contact")) return "TOOL";
  if (m.includes("stt") || m.includes("transcript") || m.includes("deepgram") || m.includes("keyterm")) return "STT";
  if (m.includes("llm") || m.includes("groq") || m.includes("gemini_llm") || m.includes("recovery")) return "LLM";
  if (m.includes("tts") || m.includes("sarvam") || m.includes("gemini_tts") || m.includes("voice")) return "TTS";
  if (s === "LIVEKIT" || m.includes("audio_publish") || m.includes("audio_track") || m.includes("audio_output") || m.includes("playout") || m.includes("playback") || m.includes("diagnostic_") || m.includes("egress") || m.includes("recording")) return "AUDIO";
  if (s === "VOBIZ" || m.includes("sip") || m.includes("dial") || m.includes("call_answered") || m.includes("ring") || m.includes("participant")) return "SIP";
  if (m.startsWith("call_attempt") || m.startsWith("call_failed") || m.startsWith("dispatch") || m.includes("room_connected") || m.includes("call_requested") || m.includes("call_ended") || m.includes("call_logged") || m.includes("greeting")) return "CALL";
  if (m.includes("api_request") || m.includes("http_status") || m.includes("endpoint") || m.includes("webhook")) return "API";
  if (m.includes("worker") || m.includes("job_received") || m.includes("entrypoint") || m.includes("prewarm") || m.includes("build")) return "WORKER";
  if (m.includes("_clicked") || m.includes("_opened") || m.includes("_selected") || m.includes("page_opened")) return "UI";
  if (s === "WORKER") return "WORKER";
  if (s === "API") return "API";
  if (level === "ERROR" || level === "CRITICAL") return "ERROR";
  return "SYSTEM";
}

export function deriveStatus(level: string, message: string): Status {
  const L = level.toUpperCase();
  if (L === "CRITICAL") return "CRITICAL";
  if (L === "ERROR") return "ERROR";
  if (L === "WARNING" || L === "WARN") return "WARNING";
  const m = message.toLowerCase();
  if (m.includes("_failed") || m.includes("error") || m.includes("crash") || m.includes("exception") || m.includes("rejected")) return "ERROR";
  if (m.includes("completed") || m.includes("_ok") || m.includes("success") || m.includes("connected") || m.includes("locked") || (m.includes("started") && m.includes("ok"))) return "SUCCESS";
  return "INFO";
}

export function fingerprint(timestamp: string | number, message: string, meta: Record<string, unknown> | null, source: string): string {
  return [timestamp, message, mf(meta, "call_id"), mf(meta, "campaign_id"), mf(meta, "job_id"),
          mf(meta, "turn_id"), mf(meta, "provider"), source].join("|");
}
