// Real runtime status for a provider card.
//
// HARD RULE: a card is only CONNECTED when a REAL request succeeded — either an
// explicit health/diagnostic probe or genuine call traffic. Having an API key
// configured is never enough; that is CONFIGURED (amber) at best.
//
// Pure + dependency-free so the same derivation runs server-side (over persisted
// error_logs) and client-side (over newer live SSE events), guaranteeing the two
// can never disagree.
import { type LiveEvent, mf } from "./eventModel";
import { type ProviderDef, matchProvider } from "./providerRegistry";

export type CardState =
  | "CONNECTED"        // green  — a real request succeeded
  | "CONFIGURED"       // amber  — credentials exist, no successful check yet
  | "FAILED"           // red    — latest real request failed
  | "QUOTA_ERROR"      // red    — provider returned 402/429 / no credits
  | "NOT_CONFIGURED";  // gray   — required credentials missing

export type CardStatus = {
  state: CardState;
  model: string;
  httpStatus: number | null;
  latencyMs: number | null;
  lastCheckedTs: number | null;
  errorReason: string;
  /** "diagnostic" = health probe, "runtime" = real call traffic. */
  via: "diagnostic" | "runtime" | null;
};

const ERR_LEVELS = new Set(["ERROR", "CRITICAL"]);
const isDiag = (e: LiveEvent) => mf(e.meta, "traffic_type") === "diagnostic";

// Events that never carried a status/latency serialise as "" or 0; neither is a
// real HTTP code or a real measurement, so both render as "—" rather than "0".
function num(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Quota/credit exhaustion is called out separately from a generic failure. */
function isQuota(http: number | null, text: string): boolean {
  if (http === 402 || http === 429) return true;
  return /quota|credit|insufficient|exhaust|depleted|billing|payment|rate limit|too many requests/i.test(text);
}

/**
 * A human one-liner for a failure. Providers answer with raw JSON bodies, so
 * prefer our own diagnosed root_cause and otherwise lift the nested
 * `message` out of the payload rather than dumping the blob into the card.
 */
function failureReason(e: LiveEvent): string {
  const root = mf(e.meta, "root_cause", "reason");
  const raw = mf(e.meta, "error", "detail");
  let inner = "";
  if (raw.trim().startsWith("{")) {
    try {
      const j = JSON.parse(raw);
      inner = j?.error?.message || j?.message || j?.detail || "";
    } catch {
      inner = (raw.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || "";
    }
  }
  const text = [root, inner || raw, mf(e.meta, "impact"), e.message].find((x) => x && x.trim()) || e.message;
  return text.replace(/\s+/g, " ").trim();
}

/** Did this event prove the provider actually worked? */
function isSuccessEvent(e: LiveEvent): boolean {
  if (ERR_LEVELS.has((e.level || "").toUpperCase())) return false;
  const m = e.message;
  if (/^diagnostic_completed$/i.test(m)) {
    const st = mf(e.meta, "status");
    return st === "" || st === "healthy" || st === "warning";
  }
  if (/^diagnostic_(started|request_sent)$/i.test(m)) return false;
  return /_completed$|_connected$|_received$|_ok$|_final|answered|registered|audio_generated|transcript/i.test(m);
}

function isFailureEvent(e: LiveEvent): boolean {
  if (ERR_LEVELS.has((e.level || "").toUpperCase())) return true;
  return /^diagnostic_failed$/i.test(e.message) || /_failed$|_error$|invalid_config|exhausted/i.test(e.message);
}

/**
 * Derive one provider's card status from the events available.
 * `events` may be persisted history, live SSE events, or both — the newest
 * decisive event wins, so a card turns green the moment a real call succeeds.
 */
export function deriveCardStatus(
  def: ProviderDef,
  events: LiveEvent[],
  configured: boolean,
): CardStatus {
  const mine = events.filter((e) => matchProvider(def, e));
  // Newest first — the latest decisive event is the current truth.
  const sorted = [...mine].sort((a, b) => b.ts - a.ts);

  let decisive: LiveEvent | null = null;
  let ok = false;
  for (const e of sorted) {
    if (isFailureEvent(e)) { decisive = e; ok = false; break; }
    if (isSuccessEvent(e)) { decisive = e; ok = true; break; }
  }

  // Best-effort descriptive fields, taken from the newest event that carries them.
  const pick = (...keys: string[]) => {
    for (const e of sorted) { const v = mf(e.meta, ...keys); if (v) return v; }
    return "";
  };
  const model = pick("model", "tts_model") || "";

  if (!decisive) {
    return {
      state: configured ? "CONFIGURED" : "NOT_CONFIGURED",
      model, httpStatus: null, latencyMs: null, lastCheckedTs: null,
      errorReason: configured ? "No successful check yet" : "Credentials not configured",
      via: null,
    };
  }

  const http = num(mf(decisive.meta, "http_status", "status_code"));
  const latency = num(mf(decisive.meta, "latency_ms", "total_ms", "elapsed_ms"));
  const via = isDiag(decisive) ? "diagnostic" : "runtime";
  const reason = failureReason(decisive);

  if (ok) {
    return {
      state: "CONNECTED",
      model: mf(decisive.meta, "model") || model,
      httpStatus: http, latencyMs: latency, lastCheckedTs: decisive.ts,
      errorReason: "", via,
    };
  }

  // Not configured still wins over a failure caused by missing credentials.
  if (!configured) {
    return {
      state: "NOT_CONFIGURED", model, httpStatus: http, latencyMs: latency,
      lastCheckedTs: decisive.ts, errorReason: "Credentials not configured", via,
    };
  }

  return {
    state: isQuota(http, `${reason} ${decisive.message} ${mf(decisive.meta, "error", "detail")}`)
      ? "QUOTA_ERROR" : "FAILED",
    model: mf(decisive.meta, "model") || model,
    httpStatus: http, latencyMs: latency, lastCheckedTs: decisive.ts,
    errorReason: reason.slice(0, 160), via,
  };
}

export const CARD_STYLE: Record<CardState, { label: string; dot: string; text: string; icon: string }> = {
  CONNECTED:      { label: "CONNECTED",      dot: "bg-emerald-400", text: "text-emerald-300", icon: "✅" },
  CONFIGURED:     { label: "CONFIGURED",     dot: "bg-amber-400",   text: "text-amber-300",   icon: "⚠️" },
  FAILED:         { label: "FAILED",         dot: "bg-red-500",     text: "text-red-300",     icon: "❌" },
  QUOTA_ERROR:    { label: "QUOTA ERROR",    dot: "bg-red-500",     text: "text-red-300",     icon: "❌" },
  NOT_CONFIGURED: { label: "NOT CONFIGURED", dot: "bg-gray-600",    text: "text-gray-400",    icon: "⚪" },
};
