"use client";

// VOICE PIPELINE — LIVE DIAGNOSTICS (two views)
//
//   • Simple "Call Journey"  — non-technical: where is the call right now / where
//     did it break, with providers as small secondary labels.
//   • Technical Diagnostics  — collapsible raw event table for debugging.
//
// Observability only. Reuses the EXISTING Live Logs SSE (/api/logs/proxy) for
// realtime pipeline state, and two read-only dashboard routes for data not in the
// log stream: /api/voice/health (API+DB) and /api/voice/transcript (persisted
// transcript + recording URL + assistant, by room). Nothing here touches the
// realtime audio loop.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Radio, Ear, Brain, AudioLines, Send, PhoneCall,
  CheckCircle2, XCircle, AlertTriangle,
  Pause, Play, Trash2, Wifi, WifiOff, ChevronDown, ChevronRight,
  Headphones, Bot, MousePointerClick, Server, Share2, Cpu,
} from "lucide-react";
import CallRecording from "./CallRecording";
import ProviderActivityPanel from "./ProviderActivityPanel";
import { PROVIDERS } from "@/lib/providerRegistry";
import { useLiveEvents } from "@/lib/liveEvents";

type Status = "idle" | "processing" | "success" | "failed";
type Conn = "connecting" | "open" | "closed" | "error";

export type RawLog = { id?: string; source?: string; level?: string; message?: string; detail?: string; timestamp?: string };
export type Evt = {
  id: string; source: string; level: string; name: string;
  // `cid` is the CANONICAL ROOM NAME (matches Call.livekitRoomName) — never the
  // DB call UUID. dbCallId holds the UUID separately when present.
  ts: number; tsLabel: string; cid: string | null; dbCallId: string | null; meta: Record<string, unknown>;
};

const MAX_EVENTS = 1500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One real telephony call for the timeline graph (from /api/voice/calls).
type CallRow = {
  id: string; room: string; status: string; outcome: string | null;
  phone: string | null; assistant: string | null; voice: string | null;
  llm: string | null; llmModel: string | null; stt: string | null; tts: string | null;
  createdAt: string | null; endedAt: string | null; durationSeconds: number | null;
};

// Parse persisted error_logs rows (/api/voice/events) into the same Evt shape the
// live SSE produces, so a selected historical call runs through the SAME derive().
export function parseRawLogs(rows: RawLog[], fallbackRoom: string | null): Evt[] {
  const out: Evt[] = [];
  let lastRoom: string | null = fallbackRoom;
  const dbMap: Record<string, string> = {};
  for (const raw of rows) {
    let meta: Record<string, unknown> = {};
    try { meta = raw.detail ? JSON.parse(raw.detail) : {}; } catch { meta = {}; }
    const metaRoom = roomNameOf(meta);
    const metaDbId = dbCallIdOf(meta);
    if (metaRoom) lastRoom = metaRoom;
    if (metaDbId && metaRoom) dbMap[metaDbId] = metaRoom;
    const cid = metaRoom ?? (metaDbId ? dbMap[metaDbId] ?? null : null) ?? lastRoom;
    const tsMs = raw.timestamp ? Date.parse(raw.timestamp) : Date.now();
    out.push({
      id: raw.id || `${tsMs}-${Math.random()}`, source: String(raw.source || ""),
      level: String(raw.level || "INFO"), name: String(raw.message || ""),
      ts: Number.isFinite(tsMs) ? tsMs : Date.now(),
      tsLabel: new Date(Number.isFinite(tsMs) ? tsMs : Date.now()).toLocaleTimeString(),
      cid, dbCallId: metaDbId, meta,
    });
  }
  return out;
}

// Smooth (Catmull-Rom → cubic-bezier) path so the timeline reads as a clean
// curve like the dashboard's Calls Timeline, not a jagged scatter line.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// Which pipeline stages EVER succeeded in a call's events (scans all events, not
// just the last turn). Fixes stages wrongly showing IDLE for a finished call.
export function reachedFromEvents(evts: Evt[]): Record<string, boolean> {
  const r: Record<string, boolean> = {};
  const lifeOk = () => { r.request = true; r.api = true; r.dispatch = true; r.worker = true; };
  for (const e of evts) {
    switch (e.name) {
      case "call_attempt_started": r.request = true; break;
      case "voice_api_ok": r.request = true; r.api = true; break;
      case "dispatch_ok": r.request = true; r.api = true; r.dispatch = true; break;
      case "worker_job_received": lifeOk(); break;
      case "dialing_out": lifeOk(); break;
      case "call_answered": lifeOk(); r.vobiz = true; break;
      case "room_connected": lifeOk(); r.livekit_in = true; break;
      case "sip_participant_found": case "sip_audio_track_subscribed": case "agent_input_attached": r.livekit_in = true; break;
      case "audio_frames_started": case "stt_partial_transcript": r.customer_in = true; break;
      case "stt_final_transcript": r.customer_in = true; r.deepgram = true; break;
      case "llm_response_received": case "llm_response_completed": r.groq = true; break;
      case "tts_audio_completed": r.sarvam = true; break;
      case "agent_audio_publish_completed": r.livekit_out = true; r.customer_out = true; break;
    }
  }
  return r;
}

// Map a DB CallStatus/outcome to the timeline dot color + a plain label.
function callTone(c: CallRow): { color: string; label: "Completed" | "Failed" | "Blocked" | "Active" | "Unknown" } {
  const s = (c.status || "").toUpperCase();
  if (s === "FAILED" || s === "BUSY" || s === "NO_ANSWER") return { color: "#f87171", label: "Failed" };
  if (s === "IN_PROGRESS" || s === "RINGING" || s === "QUEUED") return { color: "#fbbf24", label: "Active" };
  if (s === "COMPLETED") return { color: "#34d399", label: "Completed" };
  if (s === "CANCELED") return { color: "#9ca3af", label: "Unknown" };
  return { color: "#9ca3af", label: "Unknown" };
}

function num(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// Correlation identifiers. The worker logs the LiveKit room name in `room` OR in
// `call_id` (when call_id isn't the DB UUID); a few end-of-call events log the DB
// UUID in `call_id`. The canonical call key is ALWAYS the room name — so these
// two conventions resolve to one group instead of splitting the call.
function roomNameOf(meta: Record<string, unknown>): string | null {
  const room = num(meta.room); if (room && !UUID_RE.test(room)) return room;
  const cid = num(meta.call_id); if (cid && !UUID_RE.test(cid)) return cid;
  return room ?? null;
}
function dbCallIdOf(meta: Record<string, unknown>): string | null {
  const cid = num(meta.call_id); return cid && UUID_RE.test(cid) ? cid : null;
}


type Step = { ts: number; label: string; tech: string; kind: "ok" | "proc" | "bad" };
type Turn = {
  n: number; caller: string; ts: number;
  stt: Status; llm: Status; tts: Status; output: Status;
  sttMs?: number; llmMs?: number; ttsMs?: number; outMs?: number; e2eMs?: number; firstAudioMs?: number;
  // Per-turn truth (item 6): full generated text vs what was actually played,
  // and why a reply was short. Populated from turn_summary / played_text /
  // incomplete_llm_response / llm_rate_limited backend events.
  primaryLlmFailed?: boolean; llmVia?: string;
  fullText?: string; fullLen?: number; playedText?: string;
  interrupted?: boolean; rateLimited?: boolean; incomplete?: boolean;
  steps: Step[];
};
// Classify a short/odd reply so the UI shows the REAL cause, never a guess.
type TurnCause = "ok" | "rate_limit" | "llm_fragment" | "playback_cut" | "barge_in" | "pending";
function classifyTurn(t: Turn): TurnCause {
  if (t.rateLimited) return "rate_limit";
  const full = (t.fullText ?? "").trim();
  const played = (t.playedText ?? "").trim();
  const shortFull = full.length > 0 && full.split(/\s+/).length <= 2 && !/[.!?]$/.test(full);
  if (t.incomplete || shortFull) return "llm_fragment";          // CASE A
  if (full && played && played.length < full.length * 0.6) {      // CASE B/D
    return t.interrupted ? "barge_in" : "playback_cut";
  }
  if (t.interrupted) return "barge_in";                           // CASE D
  if (t.llm === "success" && t.output === "success") return "ok";
  return "pending";
}
type Greeting = { mode: string; generated: boolean; voice: boolean; delivered: boolean; interrupted: boolean; failed: boolean } | null;
type GroqInfo = { model: string | null; totalTokens?: number; systemTokens?: number; toolTokens?: number; historyTokens?: number; currentTokens?: number; ttftMs?: number; rateLimited: boolean; providerBody?: string };

// Structured, human- + machine-readable description of the ONE failure (or
// stuck stage) that broke this call/attempt. Everything the end-to-end monitor
// must answer — WHAT stage, WHY (human + technical), WHEN, last good stage,
// next expected stage, HTTP/provider codes, correlation IDs — lives here so the
// dashboard never needs the WSL logs.
export type FailInfo = {
  stageKey: string;        // FLOW_NODES key of the failed/stuck stage
  stageLabel: string;      // human stage name ("Voice API")
  reason: string;          // human-readable reason
  errorType: string | null;    // machine error_type ("HTTP_504", "rate_limit"…)
  httpStatus: number | null;
  providerCode: string | null; // SIP code / provider body
  lastSuccessful: string | null;
  nextExpected: string | null;
  attemptId: string | null;
  room: string | null;
  kind: "failed" | "stuck";
  ts: number;
  elapsedMs: number | null;
};

export type Derived = {
  header: { phone: string | null; assistant: string | null; room: string | null; status: string };
  providers: { stt?: string; sttModel?: string; llm?: string; llmModel?: string; tts?: string; voice?: string };
  callLevel: { connected: Status; connectedNote: string; aiConnected: Status };
  // Pre-room lifecycle stages (before any LiveKit room/worker exists). These let
  // a browser/API/dispatch/worker failure surface in the pipeline view.
  lifecycle: { request: Status; api: Status; dispatch: Status; worker: Status };
  turnStages: { listening: Status; thinking: Status; voice: Status; sending: Status; reply: Status };
  greeting: Greeting;
  turns: Turn[];
  state: string;                 // human-readable
  rawState: string;              // dev state
  bargein: { last: number | null; recovered: boolean | null; count: number };
  perf: { durationMs: number | null; stt?: number; llm?: number; llmTtft?: number; tts?: number; ttsTtfb?: number; out?: number; e2e?: number };
  breakLabel: string | null; breakProvider: string; breakReason: string; breakTs: number | null;
  breakStageKey: string | null; // FLOW_NODES key of the failed stage (drives the cards)
  fail: FailInfo | null;         // full structured failure/stuck description
  stuck: boolean;                // break was a diagnostic TIMEOUT (agent stuck), not a provider error
  lastAgentEventTs: number;      // for worker-alive inference
  lastEvent: { name: string; ts: number } | null;
  ended: boolean;
  build: string | null;          // AGENT_BUILD reported by this call's worker
  llmFallback: { primaryFailed: boolean; active: boolean; used: boolean; failed: boolean; label: string | null; errorType: string | null };
  // Live per-node metadata for the click-to-inspect panels + Groq rate-limit view.
  groq: GroqInfo | null;
};

// Diagnostic stuck/timeout thresholds (ms). These NEVER end the real call — they
// only colour the dashboard so a hung stage is visible. One place to tune, not
// scattered magic numbers (item 7).
const THRESHOLDS = {
  listening: 15000,  // STT final after the caller is detected speaking
  thinking: 12000,   // Groq response after the request started
  voice: 12000,      // Sarvam completion after TTS started
  sending: 8000,     // LiveKit publish completion after TTS done
} as const;

const STATE_HUMAN: Record<string, string> = {
  LISTENING: "LISTENING", THINKING: "UNDERSTANDING", SPEAKING: "SPEAKING",
  INTERRUPTED: "INTERRUPTED", IDLE: "WAITING FOR CALLER", INITIALIZING: "WAITING FOR CALLER",
};

// Canonical per-stage metadata for the end-to-end lifecycle. `label` is the
// human stage name; `lastOk`/`next` are the default "last successful" / "next
// expected" phrases used when a failure at that stage doesn't carry its own.
const STAGE_META: Record<string, { label: string; provider: string; lastOk: string; next: string }> = {
  request:     { label: "Call Request",    provider: "Browser",        lastOk: "(call button clicked)",   next: "Voice API accepts request" },
  api:         { label: "Voice API",        provider: "Voice API",      lastOk: "Call request sent",       next: "LiveKit dispatch created" },
  dispatch:    { label: "LiveKit Dispatch", provider: "LiveKit",        lastOk: "Voice API accepted",      next: "Worker receives job" },
  worker:      { label: "Worker",           provider: "Voice worker",   lastOk: "Dispatch created",        next: "LiveKit room connected" },
  livekit_in:  { label: "LiveKit Room",     provider: "LiveKit / SIP",  lastOk: "Worker received job",     next: "Call answered" },
  vobiz:       { label: "Vobiz / SIP",      provider: "Vobiz",          lastOk: "LiveKit room connected",  next: "Customer audio / STT" },
  deepgram:    { label: "Deepgram STT",     provider: "Deepgram",       lastOk: "Customer audio in",       next: "Groq LLM request" },
  groq:        { label: "Groq LLM",         provider: "Groq",           lastOk: "Deepgram final transcript", next: "Sarvam TTS" },
  sarvam:      { label: "Sarvam TTS",       provider: "Sarvam",         lastOk: "Groq response",           next: "LiveKit audio publish" },
  livekit_out: { label: "LiveKit Output",   provider: "LiveKit",        lastOk: "Sarvam audio ready",      next: "Audio delivered to caller" },
  customer_out:{ label: "Customer Reply",   provider: "SIP audio out",  lastOk: "Audio published",         next: "Next customer turn" },
};
// Order of the full pipeline, used to grey out stages AFTER the failed one.
const STAGE_ORDER = ["request", "api", "dispatch", "worker", "livekit_in", "vobiz", "deepgram", "groq", "sarvam", "livekit_out", "customer_out"] as const;
// How long after a successful dispatch we wait for the worker to pick up the job
// before calling it STUCK (worker unavailable / init timeout). Normal pickup is
// sub-second; the forkserver init-loop failure never picks up at all.
const WORKER_PICKUP_MS = 18000;

export function derive(events: Evt[], nowMs: number): Derived {
  const header: Derived["header"] = { phone: null, assistant: null, room: null, status: "Idle" };
  const providers: Derived["providers"] = {};
  const callLevel = { connected: "idle" as Status, connectedNote: "", aiConnected: "idle" as Status };
  const turnStages = { listening: "idle" as Status, thinking: "idle" as Status, voice: "idle" as Status, sending: "idle" as Status, reply: "idle" as Status };
  const turns: Turn[] = [];
  let greeting: Greeting = null;
  let rawState = "IDLE";
  const bargein = { last: null as number | null, recovered: null as boolean | null, count: 0 };
  let ended = false;
  let answeredTs = 0, endedTs = 0, lastAgentEventTs = 0;

  let inTurn = false;
  let cur: Turn | null = null;
  let build: string | null = null;
  let lastPartialTs = 0, sttFinalTs = 0, llmStartTs = 0, ttsStartTs = 0, ttsDoneTs = 0;
  let speakingTs = 0;            // caller entered "speaking" (for listening-stuck)
  let llmTtft: number | undefined, ttsTtfb: number | undefined;
  let lastEvt: { name: string; ts: number } | null = null;
  let groqTok: GroqInfo | null = null;
  let stuck = false;
  const llmFallback = { primaryFailed: false, active: false, used: false, failed: false, label: null as string | null, errorType: null as string | null };
  const step = (label: string, tech: string, kind: Step["kind"], ts: number) => {
    if (cur) cur.steps.push({ ts, label, tech, kind });
  };
  // Pre-room lifecycle state (Call Request → Voice API → Dispatch → Worker).
  const lifecycle = { request: "idle" as Status, api: "idle" as Status, dispatch: "idle" as Status, worker: "idle" as Status };
  let attemptId: string | null = null;
  let dispatchOkTs = 0;
  // break tracking
  let breakLabel: string | null = null, breakProvider = "", breakReason = "", breakTs: number | null = null;
  let breakStageKey: string | null = null;
  let fail: FailInfo | null = null;
  // The SINGLE failure sink. First failure wins (the earliest broken stage is
  // the real root cause; later cascades are symptoms). Populates both the legacy
  // break fields (so existing UI keeps working) and the structured FailInfo.
  const recordFail = (
    stageKey: string, reason: string, ts: number,
    extras?: { errorType?: string | null; httpStatus?: number | null; providerCode?: string | null; lastSuccessful?: string | null; nextExpected?: string | null; kind?: "failed" | "stuck"; elapsedMs?: number | null; provider?: string },
  ) => {
    if (fail) return;
    const meta = STAGE_META[stageKey] ?? { label: stageKey, provider: stageKey, lastOk: "—", next: "—" };
    const kind = extras?.kind ?? "failed";
    fail = {
      stageKey, stageLabel: meta.label, reason,
      errorType: extras?.errorType ?? null, httpStatus: extras?.httpStatus ?? null,
      providerCode: extras?.providerCode ?? null,
      lastSuccessful: extras?.lastSuccessful ?? meta.lastOk,
      nextExpected: extras?.nextExpected ?? meta.next,
      attemptId, room: header.room,
      kind, ts, elapsedMs: extras?.elapsedMs ?? null,
    };
    breakStageKey = stageKey;
    breakLabel = meta.label; breakProvider = extras?.provider ?? meta.provider;
    breakReason = reason; breakTs = ts;
    if (kind === "stuck") stuck = true;
  };
  // Legacy human-label break API (kept so existing in-call call sites are a
  // one-line change). Maps the human stage label to the canonical stage key.
  const LABEL_TO_STAGE: Record<string, string> = {
    "Call Connected": "vobiz", "Listening to Customer": "deepgram",
    "Understanding / Thinking": "groq", "Creating Voice": "sarvam",
    "Sending AI Voice": "livekit_out",
  };
  const flagBreak = (label: string, provider: string, reason: string, ts: number, extras?: Parameters<typeof recordFail>[3]) => {
    recordFail(LABEL_TO_STAGE[label] ?? label, reason, ts, { provider, ...extras });
  };

  for (const e of events) {
    const m = e.meta, name = e.name, ts = e.ts;
    const agentish = ["WORKER", "STT", "LLM", "TTS", "SESSION", "TURN_DETECTION", "VOBIZ", "LIVEKIT"].includes(e.source.toUpperCase());
    if (agentish) lastAgentEventTs = Math.max(lastAgentEventTs, ts);
    if (m.build) build = String(m.build);
    if (agentish) lastEvt = { name, ts };
    if (m.call_attempt_id) attemptId = num(m.call_attempt_id) ?? attemptId;
    // Groq real input-token breakdown + TTFT for the Groq node detail panel (13).
    if (name === "groq_input_tokens") {
      if (!groqTok) groqTok = { model: providers.llmModel ?? null, rateLimited: false };
      groqTok.model = providers.llmModel ?? groqTok.model ?? null;
      groqTok.totalTokens = Number(m.total_input_tokens) || undefined;
      groqTok.systemTokens = Number(m.system_prompt_tokens) || undefined;
      groqTok.toolTokens = Number(m.tool_schema_tokens) || undefined;
      groqTok.historyTokens = Number(m.conversation_history_tokens) || undefined;
      groqTok.currentTokens = Number(m.current_user_tokens) || undefined;
    }
    if (name === "audio_frames_started") {
      // speakingTs is ALWAYS the latest utterance start (never the first-of-call),
      // so the listening stuck-timer measures the current turn, not an ancient one.
      speakingTs = ts;
      // A new utterance while we are NOT mid-generation = a fresh turn: clear the
      // previous turn's downstream success and per-turn start timestamps so the
      // cards never show "Deepgram stuck" next to a prior turn's "Groq done".
      const generating = turnStages.thinking === "processing" || turnStages.voice === "processing" || turnStages.sending === "processing";
      if (!generating) {
        turnStages.listening = "processing";
        turnStages.thinking = "idle"; turnStages.voice = "idle";
        turnStages.sending = "idle"; turnStages.reply = "idle";
        llmStartTs = 0; ttsStartTs = 0; ttsDoneTs = 0;
      }
    }

    switch (name) {
      // ── Pre-room lifecycle (browser → API → dispatch → worker) ────────────
      case "call_attempt_started":
        lifecycle.request = "success"; lifecycle.api = "processing";
        header.phone = num(m.phone) ?? header.phone;
        header.assistant = num(m.assistant) ?? header.assistant;
        if (header.status === "Idle") header.status = "Dialing";
        break;
      case "voice_api_ok":
        lifecycle.request = "success"; lifecycle.api = "success"; lifecycle.dispatch = "processing";
        break;
      case "dispatch_ok":
        lifecycle.request = "success"; lifecycle.api = "success"; lifecycle.dispatch = "success";
        lifecycle.worker = "processing"; dispatchOkTs = ts;
        header.room = num(m.room) ?? header.room;
        header.phone = num(m.phone) ?? header.phone;
        header.assistant = num(m.assistant) ?? header.assistant;
        if (header.status === "Idle" || header.status === "Dialing") header.status = "Dispatched";
        break;
      case "call_canceled_by_user":
        ended = true; endedTs = ts; header.status = "Ended"; break;
      case "call_failed": {
        // A browser/API/dispatch failure published by the Calls page. `stage`
        // says where it broke; the structured fields carry the full reason.
        const stage = num(m.stage) || "api";
        if (stage === "api") { lifecycle.request = "success"; lifecycle.api = "failed"; }
        else if (stage === "dispatch") { lifecycle.request = "success"; lifecycle.api = "success"; lifecycle.dispatch = "failed"; }
        else if (stage === "request") { lifecycle.request = "failed"; }
        header.phone = num(m.phone) ?? header.phone;
        header.assistant = num(m.assistant) ?? header.assistant;
        header.status = "Failed";
        recordFail(stage, num(m.reason) ?? "Call failed", ts, {
          errorType: num(m.error_type), httpStatus: m.http_status != null ? Number(m.http_status) : null,
          providerCode: num(m.provider_code), lastSuccessful: num(m.last_successful),
          nextExpected: num(m.next_expected), elapsedMs: m.elapsed_ms != null ? Number(m.elapsed_ms) : null,
        });
        break;
      }
      // ── Worker-side structured failure events (published by agent.py) ─────
      case "worker_init_failed":
        lifecycle.worker = "failed"; header.status = "Failed";
        recordFail("worker", num(m.reason) ?? "Worker initialization failed", ts, { errorType: num(m.error_type) ?? "worker_init_failed", provider: "Voice worker" });
        break;
      case "dispatch_failed":
        lifecycle.dispatch = "failed"; header.status = "Failed";
        recordFail("dispatch", num(m.reason) ?? "Dispatch failed", ts, { errorType: num(m.error_type) ?? "dispatch_failed" });
        break;
      case "sip_failed": case "call_not_answered":
        callLevel.connected = "failed"; header.status = "Failed";
        recordFail("vobiz", num(m.reason) ?? (name === "call_not_answered" ? "Call not answered" : "SIP/telephony failure"), ts, {
          errorType: num(m.error_type) ?? name, providerCode: num(m.sip_status) ?? num(m.provider_code),
        });
        break;
      case "dialing_out": callLevel.connected = "processing"; callLevel.connectedNote = "ringing"; header.phone = num(m.phone); header.status = "Dialing"; lifecycle.worker = "success"; break;
      case "call_answered": callLevel.connected = "success"; callLevel.connectedNote = "answered"; header.phone = num(m.phone) ?? header.phone; header.status = "Connected"; answeredTs = ts; break;
      case "dial_out_failed": {
        callLevel.connected = "failed"; header.status = "Failed";
        lifecycle.request = "success"; lifecycle.api = "success"; lifecycle.dispatch = "success"; lifecycle.worker = "success";
        const errTxt = num(m.error) ?? "dial failed";
        // Pull a SIP status code (486 busy, 480/487 no-answer, 603 declined…)
        // out of the LiveKit SIP error so the provider code shows in the banner.
        const sipM = /\b(4\d\d|5\d\d|6\d\d)\b/.exec(errTxt);
        const sip = sipM ? Number(sipM[1]) : null;
        const lower = errTxt.toLowerCase();
        const noAnswer = sip === 480 || sip === 487 || lower.includes("not answered") || lower.includes("no answer") || lower.includes("timeout");
        recordFail("vobiz", errTxt, ts, {
          provider: "Vobiz",
          errorType: noAnswer ? "call_not_answered" : sip === 486 ? "sip_busy" : sip ? `sip_${sip}` : "dial_out_failed",
          providerCode: sip != null ? `SIP ${sip}` : null,
        });
        break;
      }
      case "worker_job_received":
        // Worker picked up the job → every pre-room stage succeeded.
        lifecycle.request = "success"; lifecycle.api = "success"; lifecycle.dispatch = "success"; lifecycle.worker = "success";
        if (callLevel.aiConnected === "idle") callLevel.aiConnected = "processing";
        break;
      case "room_connected":
        lifecycle.request = "success"; lifecycle.api = "success"; lifecycle.dispatch = "success"; lifecycle.worker = "success";
        callLevel.aiConnected = "processing"; header.room = num(m.room) ?? header.room;
        break;
      case "audio_track_subscribed": callLevel.aiConnected = "success"; break;
      case "assistant_profile_loaded":
        // Do NOT set room from call_id here — room correlation is handled by the
        // canonical cid (room name). Only read assistant + provider fields.
        header.assistant = num(m.assistant_name) ?? header.assistant;
        providers.stt = num(m.stt_provider) ?? providers.stt;
        providers.llm = num(m.llm_provider) ?? providers.llm;
        providers.llmModel = num(m.llm_model) ?? providers.llmModel;
        providers.tts = num(m.tts_provider) ?? providers.tts;
        providers.voice = num(m.voice_id) ?? providers.voice;
        break;
      case "sip_audio_track_subscribed":
      case "agent_input_attached":
        // The real SIP caller's audio is attached to AgentSession input.
        if (turnStages.listening === "idle") turnStages.listening = "processing";
        break;
      case "audio_frames_started":
      case "input_speech_started":
      case "sip_audio_frames_received":
        // Real caller audio frames reached the agent → actively listening.
        turnStages.listening = "processing";
        break;
      case "stt_partial_transcript":
        lastPartialTs = lastPartialTs || ts;
        turnStages.listening = "processing";
        break;
      case "stt_final_transcript": {
        inTurn = true;
        sttFinalTs = ts;
        // New turn → clear per-turn start timestamps so a later completion can
        // only pair with THIS turn's start (no cross-turn 46s/20s artefacts).
        llmStartTs = 0; ttsStartTs = 0; ttsDoneTs = 0; speakingTs = 0;
        const sttMs = lastPartialTs ? ts - lastPartialTs : undefined;
        lastPartialTs = 0;
        cur = { n: turns.length + 1, caller: num(m.text) ?? "", ts, stt: "success", llm: "processing", tts: "idle", output: "idle", sttMs, steps: [] };
        turns.push(cur);
        step("Customer speech detected", "stt_final_transcript", "ok", ts);
        step("Transcript final", `“${(num(m.text) ?? "").slice(0, 40)}”`, "ok", ts);
        turnStages.listening = "success";
        turnStages.thinking = "processing";
        turnStages.voice = "idle"; turnStages.sending = "idle"; turnStages.reply = "idle";
        // Fresh fallback state for this turn.
        llmFallback.primaryFailed = false; llmFallback.active = false;
        llmFallback.used = false; llmFallback.failed = false;
        break;
      }
      case "llm_request_started":
        // ONLY a real customer turn (after stt_final) may advance Understanding.
        // Greeting/generic LLM events must NOT mark the customer pipeline green.
        if (inTurn) { llmStartTs = ts; turnStages.thinking = "processing"; if (cur) cur.llm = "processing"; step("Sending request to AI", "llm_request_started", "proc", ts); }
        break;
      case "llm_response_completed":
      case "llm_response_received":
        if (Number(m.ttft_ms)) llmTtft = Number(m.ttft_ms);
        if (groqTok && Number(m.ttft_ms)) groqTok.ttftMs = Number(m.ttft_ms);
        if (inTurn) { turnStages.thinking = "success"; if (cur) { cur.llm = "success"; cur.llmMs = llmStartTs ? ts - llmStartTs : undefined; } step("AI response complete", "llm_response_received", "ok", ts); }
        break;
      case "llm_rate_limited":
        // Groq ITPM 429. The reply is NOT trustworthy — mark "Understanding /
        // Thinking" red, never green (L). Flag even outside a turn (greeting).
        turnStages.thinking = "failed"; if (cur) { cur.llm = "failed"; cur.rateLimited = true; }
        if (groqTok) { groqTok.rateLimited = true; groqTok.providerBody = num(m.provider_body) ?? groqTok.providerBody; }
        else groqTok = { model: providers.llmModel ?? null, rateLimited: true, providerBody: num(m.provider_body) ?? undefined };
        step("AI provider rate limit (429)", num(m.provider_body) ?? "llm_rate_limited", "bad", ts);
        flagBreak("Understanding / Thinking", providers.llm || "Groq", "LLM provider rate limit (HTTP 429)", ts, { errorType: "rate_limit", httpStatus: 429, providerCode: num(m.provider_body) });
        break;
      case "incomplete_llm_response":
        // Model produced a fragment ("I'm") that was not a real interruption.
        turnStages.thinking = "failed"; if (cur) { cur.llm = "failed"; cur.incomplete = true; }
        step("Incomplete AI response", `“${num(m.text) ?? ""}”`, "bad", ts);
        flagBreak("Understanding / Thinking", providers.llm || "Groq", "LLM returned an incomplete response", ts, { errorType: "incomplete_generation" });
        break;
      // ── Runtime LLM fallback router (P0) ──────────────────────────────────
      case "primary_llm_failed":
        // Groq (primary) failed/returned an incomplete reply. The turn is NOT a
        // failure yet — the fallback is about to run. Record it so the Groq node
        // reads "failed → recovered" if the fallback completes.
        llmFallback.primaryFailed = true;
        llmFallback.errorType = num(m.error_type) ?? llmFallback.errorType;
        if (cur) cur.primaryLlmFailed = true;
        step(`Groq failed (${num(m.error_type) ?? "error"})`, "primary_llm_failed", "bad", ts);
        break;
      case "fallback_llm_started":
        llmFallback.active = true; llmFallback.label = num(m.provider) ?? llmFallback.label;
        turnStages.thinking = "processing"; if (cur) cur.llm = "processing";
        step(`Fallback LLM active (${num(m.provider) ?? "?"})`, "fallback_llm_started", "proc", ts);
        break;
      case "fallback_llm_completed":
        // Fallback answered the same turn → overall turn SUCCEEDS.
        llmFallback.active = false; llmFallback.used = true; llmFallback.label = num(m.provider) ?? llmFallback.label;
        turnStages.thinking = "success"; if (cur) { cur.llm = "success"; cur.llmVia = num(m.provider) ?? undefined; }
        step(`Fallback LLM completed (${num(m.provider) ?? "?"})`, "fallback_llm_completed", "ok", ts);
        break;
      case "fallback_llm_failed":
        llmFallback.active = false; llmFallback.failed = true;
        turnStages.thinking = "failed"; if (cur) cur.llm = "failed";
        step("Fallback LLM failed", "fallback_llm_failed", "bad", ts);
        flagBreak("Understanding / Thinking", providers.llm || "Groq", "Primary + fallback LLM both failed", ts, { errorType: llmFallback.errorType ?? "llm_failed" });
        break;
      case "llm_recovery_spoken":
        // Both unavailable/failed and no fallback succeeded → local line played.
        if (!llmFallback.used) {
          turnStages.thinking = "failed"; if (cur) cur.llm = "failed";
          flagBreak("Understanding / Thinking", providers.llm || "Groq",
                    llmFallback.primaryFailed ? "primary failed, no working fallback" : "no LLM response", ts);
        }
        break;
      case "turn_summary":
        // Full generated text + interruption flag for the latest ASSISTANT turn.
        if (cur && String(m.role) === "assistant") {
          cur.fullText = num(m.text) ?? cur.fullText;
          cur.fullLen = Number(m.text_len) || cur.fullLen;
          cur.interrupted = Boolean(m.interrupted) || cur.interrupted;
        }
        break;
      case "tts_request_started":
        // TTS started generating. Do NOT advance "Sending" here — that only moves
        // when the real audio-publish event fires.
        if (inTurn) {
          ttsStartTs = ts; turnStages.thinking = "success"; turnStages.voice = "processing";
          if (cur) { if (cur.llm === "processing") { cur.llm = "success"; cur.llmMs = llmStartTs ? ts - llmStartTs : undefined; } cur.tts = "processing"; }
          step("Creating voice", "tts_request_started", "proc", ts);
        } else if (greeting) { greeting.voice = true; }
        break;
      case "tts_audio_completed":
        // Proves only that TTS GENERATED audio ("Creating Voice"). Delivery is
        // proven separately by agent_audio_publish_completed.
        if (inTurn) {
          turnStages.voice = "success"; ttsDoneTs = ts;
          if (cur) { cur.tts = "success"; cur.ttsMs = ttsStartTs ? ts - ttsStartTs : undefined; }
          step("Voice created", "tts_audio_completed", "ok", ts);
        } else if (greeting) { greeting.voice = true; }
        break;
      case "tts_metrics":
        if (Number(m.ttfb_ms)) ttsTtfb = Number(m.ttfb_ms);
        break;
      case "agent_audio_publish_started":
        // Real LiveKit audio output started pushing frames to the room/SIP.
        if (inTurn) { turnStages.sending = "processing"; if (cur) { cur.output = "processing"; cur.outMs = ttsDoneTs ? ts - ttsDoneTs : undefined; if (cur.firstAudioMs == null && sttFinalTs) cur.firstAudioMs = ts - sttFinalTs; } step("Sending voice", "agent_audio_publish_started", "proc", ts); }
        else if (greeting) greeting.voice = true;
        break;
      case "agent_audio_publish_completed":
        // Real proof the reply audio was pushed to the room → SIP participant.
        if (inTurn) {
          turnStages.sending = "success"; turnStages.reply = "success";
          if (cur) {
            cur.output = "success"; if (cur.e2eMs == null && sttFinalTs) cur.e2eMs = ts - sttFinalTs;
            if (num(m.played_text) != null) cur.playedText = num(m.played_text) ?? undefined;
            cur.interrupted = Boolean(m.interrupted) || cur.interrupted;
          }
          step("Audio sent to caller", "agent_audio_publish_completed", "ok", ts);
        } else if (greeting) { greeting.delivered = true; greeting.interrupted = greeting.interrupted || Boolean(m.interrupted); }
        break;
      case "SESSION_STATE_CHANGED": if (String(m.who) === "agent" && m.new) rawState = String(m.new).toUpperCase(); break;
      case "FIRST_GREETING_STARTED": greeting = { mode: num(m.source) ?? "default", generated: true, voice: false, delivered: false, interrupted: false, failed: false }; break;
      case "FIRST_GREETING_COMPLETED": if (greeting) { greeting.voice = true; greeting.delivered = true; greeting.interrupted = Boolean(m.interrupted); } break;
      case "FIRST_GREETING_FAILED": if (greeting) greeting.failed = true; break;
      case "interruption_detected": bargein.last = ts; bargein.recovered = false; bargein.count += 1; rawState = "INTERRUPTED"; break;
      case "session_resumed_listening": if (bargein.last && bargein.recovered === false) bargein.recovered = true; step("Listening resumed", "session_resumed_listening", "ok", ts); break;
      case "session_ended": case "call_logged": case "call_ended": case "call_ended_by_dashboard":
        ended = true; endedTs = ts; header.status = "Ended"; break;
      // Recording lifecycle (LiveKit Egress → R2). Observability only: shown in
      // the recording card + event timeline. A recording failure is NOT an
      // audio-delivery pipeline break, so these must not reach the default
      // ERROR branch below (which would wrongly flag "Sending AI Voice").
      case "recording_start_requested":
      case "recording_started":
      case "recording_stopped":
      case "recording_processing":
      case "recording_ready":
      case "recording_failed":
      case "recording_disabled_by_policy":
      case "egress_started":
      case "egress_start_failed":
      case "egress_stop_failed":
      case "egress_skipped_no_r2_config":
        break;
      default:
        if (e.level === "ERROR") {
          const s = e.source.toUpperCase(), n = name.toLowerCase();
          const et = num(m.error_type) ?? name;            // machine error type
          const reason = num(m.error) ?? num(m.reason) ?? name;
          const http = m.http_status != null ? Number(m.http_status) : null;
          if (s === "LLM" || n.includes("llm")) { turnStages.thinking = "failed"; flagBreak("Understanding / Thinking", providers.llm || "Groq", reason, ts, { errorType: et, httpStatus: http }); if (cur) cur.llm = "failed"; }
          else if (s === "TTS" || n.includes("tts") || n.includes("sarvam")) { turnStages.voice = "failed"; flagBreak("Creating Voice", providers.tts || "Sarvam", reason, ts, { errorType: et, httpStatus: http }); if (cur) cur.tts = "failed"; }
          else if (s === "STT" || n.includes("stt") || n.includes("deepgram")) { turnStages.listening = "failed"; flagBreak("Listening to Customer", providers.stt || "Deepgram", reason, ts, { errorType: et, httpStatus: http }); }
          else if (s === "LIVEKIT" || n.includes("publish") || n.includes("output")) { if (inTurn) { turnStages.sending = "failed"; if (cur) cur.output = "failed"; } flagBreak("Sending AI Voice", "LiveKit", reason, ts, { errorType: et, httpStatus: http }); }
        }
    }
  }

  // Diagnostic STUCK/TIMEOUT overlay on the CURRENT turn (items 6/7/15). These
  // colour the dashboard only — they NEVER end the real call. Each stage that has
  // been "processing" past its configured threshold becomes a RED "stuck" break
  // at the FIRST hung stage; downstream stays GREY (blocked) via the block below.
  if (!ended) {
    // STUCK_SANITY_MS: ignore an implausibly large gap — it means the start
    // timestamp is stale (an ended/old call still on screen) or browser↔worker
    // clock skew, NOT a real stall. Real stalls are seconds, not minutes.
    const STUCK_SANITY_MS = 120000;
    // Dispatch succeeded but the worker never picked up the job within the
    // window → worker unavailable / init-timeout (the forkserver init loop).
    // This surfaces a worker failure in the dashboard WITHOUT the WSL logs.
    if (lifecycle.worker === "processing" && dispatchOkTs && nowMs - dispatchOkTs > WORKER_PICKUP_MS && nowMs - dispatchOkTs < STUCK_SANITY_MS) {
      const el = nowMs - dispatchOkTs;
      lifecycle.worker = "failed";
      recordFail("worker", `Worker did not pick up the job within ${Math.round(el / 1000)}s — worker unavailable or stuck initializing`, dispatchOkTs, {
        kind: "stuck", elapsedMs: el, errorType: "worker_pickup_timeout", provider: "Voice worker",
      });
    }
    const check = (st: Status, startedTs: number, thr: number, label: string, provider: string, apply: (f: Status) => void) => {
      if (st !== "processing" || !startedTs) return;
      const el = nowMs - startedTs;
      if (el > thr && el < STUCK_SANITY_MS) {
        apply("failed");
        flagBreak(label, provider, `stuck — no progress for ${Math.round(el / 1000)}s`, startedTs, { kind: "stuck", elapsedMs: el });
        stuck = true;
      }
    };
    // Caller detected speaking but Deepgram never produced a final transcript.
    check(turnStages.listening, speakingTs, THRESHOLDS.listening, "Listening to Customer", providers.stt || "Deepgram", (f) => { turnStages.listening = f; if (cur) cur.stt = f; });
    if (cur) {
      check(turnStages.thinking, llmStartTs, THRESHOLDS.thinking, "Understanding / Thinking", providers.llm || "Groq", (f) => { turnStages.thinking = f; if (cur) cur.llm = f; });
      check(turnStages.voice, ttsStartTs, THRESHOLDS.voice, "Creating Voice", providers.tts || "Sarvam", (f) => { turnStages.voice = f; if (cur) cur.tts = f; });
      // Voice generated but never published to the room → real output delivery failure.
      if (turnStages.voice === "success" && turnStages.sending !== "success" && ttsDoneTs && nowMs - ttsDoneTs > THRESHOLDS.sending && nowMs - ttsDoneTs < STUCK_SANITY_MS) {
        turnStages.sending = "failed";
        if (cur) cur.output = "failed";
        flagBreak("Sending AI Voice", "LiveKit", "audio generated but not published to room/caller", ttsDoneTs);
        stuck = true;
      }
    }
  }
  // Block in-call stages AFTER the break so a later stage never shows green past
  // a real break (the break is the root cause; downstream is not trustworthy).
  if (breakStageKey) {
    const stageToTurn: Record<string, keyof typeof turnStages> = {
      deepgram: "listening", groq: "thinking", sarvam: "voice", livekit_out: "sending", customer_out: "reply",
    };
    const seq: (keyof typeof turnStages)[] = ["listening", "thinking", "voice", "sending", "reply"];
    // Find the first in-call turn stage at/after the broken pipeline stage.
    const brokenIdx = STAGE_ORDER.indexOf(breakStageKey as typeof STAGE_ORDER[number]);
    const bk = stageToTurn[breakStageKey];
    if (bk) {
      // In-call break: grey the turn stages strictly after it.
      const bi = seq.indexOf(bk);
      for (let i = bi + 1; i < seq.length; i++) if (turnStages[seq[i]] !== "failed") turnStages[seq[i]] = "idle";
    } else if (brokenIdx >= 0 && brokenIdx < STAGE_ORDER.indexOf("deepgram")) {
      // Pre-room break (request/api/dispatch/worker/livekit_in/vobiz): no turn
      // ever starts, so every in-call stage is Not Reached (idle).
      for (const s of seq) if (turnStages[s] !== "failed") turnStages[s] = "idle";
    }
  }

  const state = STATE_HUMAN[rawState] ?? rawState;
  const durationMs = answeredTs ? (ended && endedTs ? endedTs : nowMs) - answeredTs : null;
  const last = turns[turns.length - 1];
  const perf = {
    durationMs,
    stt: last?.sttMs, llm: last?.llmMs, llmTtft, tts: last?.ttsMs, ttsTtfb, out: last?.outMs, e2e: last?.e2eMs,
  };
  // If a failure was recorded, make sure the header never reads a non-failed
  // status — the latest attempt failed and must say so, never "Idle".
  if (fail && !ended && header.status !== "Failed") header.status = "Failed";

  return {
    header, providers, callLevel, lifecycle, turnStages, greeting, turns,
    state, rawState, bargein, perf,
    breakLabel, breakProvider, breakReason, breakTs, breakStageKey, fail, stuck,
    lastAgentEventTs, lastEvent: lastEvt, ended, build, groq: groqTok, llmFallback,
  };
}

// Expected worker build — a call served by anything else must not be trusted as
// proof of the latest fix (item 1). Keep in sync with agent.py AGENT_BUILD.
const EXPECTED_BUILD = "2026-10-07-initfix";

// Per-stage latency budgets (ms): over `warn` the stage reads amber ("high
// latency"), over `bad` it reads red — so the slow stage is obvious at a glance.
// Per-stage latency budgets aligned to the turn performance targets:
// STT ≤1.5s, LLM first ≤1.5s, TTS ≤1.0s, Output fast. Over `warn` → amber, over
// `bad` → red ("high latency"). End-to-end target <3.5s; a turn is DEGRADED >6s.
const LAT_BUDGET: Record<string, { warn: number; bad: number }> = {
  deepgram: { warn: 1500, bad: 3000 },
  groq: { warn: 1500, bad: 4000 },
  sarvam: { warn: 1000, bad: 3000 },
  livekit_out: { warn: 800, bad: 2000 },
};
const E2E_DEGRADED_MS = 6000;

const ms = (v?: number | null) => (v != null && v >= 0 ? `${Math.round(v)} ms` : "—");
const secs = (v: number | null) => {
  if (v == null || v < 0) return "—";
  const s = Math.floor(v / 1000), mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};


export const FLOW_NODES = [
  { key: "request", label: "Call Request", tech: "button → request", Icon: MousePointerClick },
  { key: "api", label: "Voice API", tech: "dispatch accepted", Icon: Server },
  { key: "dispatch", label: "LiveKit Dispatch", tech: "job created", Icon: Share2 },
  { key: "worker", label: "Worker", tech: "job received", Icon: Cpu },
  { key: "livekit_in", label: "LiveKit Room", tech: "room connected", Icon: Radio },
  { key: "vobiz", label: "Vobiz / SIP", tech: "call answered", Icon: PhoneCall },
  { key: "deepgram", label: "Deepgram", tech: "STT final", Icon: Ear },
  { key: "groq", label: "Groq", tech: "qwen3 LLM", Icon: Brain },
  { key: "sarvam", label: "Sarvam", tech: "TTS", Icon: AudioLines },
  { key: "livekit_out", label: "LiveKit Out", tech: "audio publish", Icon: Send },
  { key: "customer_out", label: "Customer", tech: "hears reply", Icon: Headphones },
] as const;

function flowStatus(d: Derived, key: string): Status {
  switch (key) {
    case "request": return d.lifecycle.request;
    case "api": return d.lifecycle.api;
    case "dispatch": return d.lifecycle.dispatch;
    case "worker": return d.lifecycle.worker;
    case "vobiz": return d.callLevel.connected;
    case "livekit_in": return d.callLevel.aiConnected;
    case "deepgram": return d.turnStages.listening;
    case "groq": return d.turnStages.thinking;
    case "sarvam": return d.turnStages.voice;
    case "livekit_out": return d.turnStages.sending;
    case "customer_out": return d.turnStages.reply;
    default: return "idle";
  }
}

const CAUSE_TEXT: Record<TurnCause, { label: string; cls: string }> = {
  ok: { label: "Healthy turn", cls: "text-emerald-300" },
  rate_limit: { label: "Groq rate limit (429) — reply discarded", cls: "text-red-300" },
  llm_fragment: { label: "LLM generated an incomplete fragment", cls: "text-red-300" },
  playback_cut: { label: "Playback cut off before the reply finished", cls: "text-amber-300" },
  barge_in: { label: "Caller interrupted (valid barge-in)", cls: "text-sky-300" },
  pending: { label: "In progress…", cls: "text-gray-400" },
};

function PerfBar({ label, ms, max, failed }: { label: string; ms?: number; max: number; failed?: boolean }) {
  const pct = failed ? 100 : ms != null && max > 0 ? Math.max(4, Math.min(100, (ms / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-14 shrink-0 text-gray-400">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
        <div className={`h-full rounded-full ${failed ? "bg-red-500/70" : "bg-cyan-400/70"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-20 shrink-0 text-right font-mono tabular-nums ${failed ? "text-red-300" : "text-gray-300"}`}>
        {failed ? "RATE LIMIT" : ms != null ? `${Math.round(ms)} ms` : "—"}
      </span>
    </div>
  );
}

function TurnDetail({ t }: { t: Turn }) {
  const cause = classifyTurn(t);
  const ct = CAUSE_TEXT[cause];
  // Per-stage latency + the single worst-over-budget stage (the bottleneck).
  const lat: Record<string, number | undefined> = { STT: t.sttMs, Groq: t.llmMs, Sarvam: t.ttsMs, Output: t.outMs };
  const budg: Record<string, { warn: number; bad: number }> = { STT: LAT_BUDGET.deepgram, Groq: LAT_BUDGET.groq, Sarvam: LAT_BUDGET.sarvam, Output: LAT_BUDGET.livekit_out };
  let bottleneck: string | null = null, worst = 0;
  for (const k of Object.keys(lat)) { const v = lat[k]; if (v != null && v - budg[k].warn > worst) { worst = v - budg[k].warn; bottleneck = k; } }
  const degraded = t.e2eMs != null && t.e2eMs > E2E_DEGRADED_MS;
  return (
    <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm text-gray-200">
          <span className="text-gray-500">Turn #{t.n} — </span>“{t.caller || "…"}”
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {degraded && <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-300">Degraded &gt;6s</span>}
          {t.llmVia && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">Fallback: {t.llmVia}</span>}
          {t.interrupted && <span className="rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-sky-300">Stale cancelled</span>}
          <span className={`text-[11px] font-medium ${ct.cls}`}>{ct.label}</span>
        </div>
      </div>

      {/* Per-stage latency with the bottleneck flagged (targets: STT/LLM ≤1.5s, TTS ≤1.0s). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {(["STT", "Groq", "Sarvam", "Output"] as const).map((k) => {
          const v = lat[k];
          const tone = v == null ? "text-gray-500" : v >= budg[k].bad ? "text-red-300" : v >= budg[k].warn ? "text-amber-300" : "text-gray-300";
          return <span key={k} className={tone}>{k} <span className="font-mono tabular-nums">{v != null ? `${Math.round(v)}ms` : "—"}</span>{bottleneck === k ? " ◀ slowest" : ""}</span>;
        })}
        <span className={t.firstAudioMs != null && t.firstAudioMs > 3000 ? "text-amber-300" : "text-gray-300"}>First audio <span className="font-mono tabular-nums">{t.firstAudioMs != null ? `${(t.firstAudioMs / 1000).toFixed(2)}s` : "—"}</span></span>
        <span className={degraded ? "text-red-300" : "text-gray-400"}>Total <span className="font-mono tabular-nums">{t.e2eMs != null ? `${(t.e2eMs / 1000).toFixed(2)}s` : "—"}</span></span>
      </div>

      {/* Event timeline — plain English first, technical name secondary. */}
      <div className="space-y-0.5">
        {t.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="font-mono tabular-nums text-gray-500">{new Date(s.ts).toLocaleTimeString(undefined, { hour12: false })}.{String(Math.floor(s.ts % 1000)).padStart(3, "0")}</span>
            <span className={s.kind === "ok" ? "text-emerald-300" : s.kind === "bad" ? "text-red-300" : "text-amber-300"}>{s.kind === "ok" ? "✓" : s.kind === "bad" ? "✕" : "●"}</span>
            <span className="text-gray-200">{s.label}</span>
            <span className="truncate text-[10px] text-gray-500">{s.tech}</span>
          </div>
        ))}
        {t.e2eMs != null && <div className="pt-1 text-[11px] text-gray-400">Total: <span className="font-mono tabular-nums text-gray-200">{(t.e2eMs / 1000).toFixed(2)} s</span></div>}
      </div>

      {/* Full vs played text — proves fragment vs playback cut (item 6). */}
      {(t.fullText || t.playedText) && (
        <div className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
          <div><span className="text-gray-500">AI generated:</span> <span className="text-gray-200">“{t.fullText ?? "—"}”</span></div>
          <div><span className="text-gray-500">Audio sent:</span> <span className="text-gray-200">“{t.playedText ?? "—"}”</span></div>
        </div>
      )}
    </div>
  );
}

// Per-node measured latency for the flow graph (real values only; undefined → "—").
export function flowLatency(d: Derived, key: string): number | undefined {
  switch (key) {
    case "deepgram": return d.perf.stt;
    case "groq": return d.perf.llm;
    case "sarvam": return d.perf.tts;
    case "livekit_out": return d.perf.out;
    default: return undefined;
  }
}

// Overall health computed ONLY from real monitored stages (item 3). A failed
// active-call stage forces FAILED regardless of the percentage.
function computeHealth(d: Derived): { pct: number; label: "Healthy" | "Degraded" | "Failed" | "Stuck" | "Processing" | "Completed" | "Idle"; color: string } {
  const req: Status[] = [
    d.lifecycle.request, d.lifecycle.api, d.lifecycle.dispatch, d.lifecycle.worker,
    d.callLevel.connected, d.callLevel.aiConnected,
    d.turnStages.listening, d.turnStages.thinking, d.turnStages.voice, d.turnStages.sending, d.turnStages.reply,
  ];
  const reached = req.filter((s) => s !== "idle");
  const ok = req.filter((s) => s === "success").length;
  const pct = reached.length === 0 ? 0 : Math.round((ok / reached.length) * 100);
  // A recorded failure/stuck ALWAYS wins — the latest attempt failed and the
  // ring must say so, never "Idle" (even for a pre-room API 504 with no stages).
  if (d.fail?.kind === "stuck") return { pct, label: "Stuck", color: "var(--tone-bad)" };
  if (d.breakLabel) return { pct, label: "Failed", color: "var(--tone-bad)" };
  if (reached.length === 0) return { pct: 0, label: "Idle", color: "var(--text-muted)" };
  if (d.ended) return { pct, label: "Completed", color: "var(--tone-good)" };
  if (reached.some((s) => s === "processing")) return { pct, label: "Processing", color: "var(--tone-warn)" };
  return { pct, label: ok === reached.length ? "Healthy" : "Degraded", color: ok === reached.length ? "var(--tone-good)" : "var(--tone-warn)" };
}

function HealthRing({ d }: { d: Derived }) {
  const h = computeHealth(d);
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - h.pct / 100);
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[88px] w-[88px] shrink-0">
        <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="8" />
          <circle cx="44" cy="44" r={r} fill="none" stroke={h.color} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .5s ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums" style={{ color: h.color }}>{h.label === "Idle" ? "—" : `${h.pct}%`}</span>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Voice agent health</div>
        <div className="text-base font-semibold" style={{ color: h.color }}>{h.label}</div>
      </div>
    </div>
  );
}

function CurrentState({ d }: { d: Derived }) {
  let txt: string, emoji: string, cls: string;
  if (d.breakLabel && d.stuck) { emoji = "⚠"; txt = `Stuck at ${d.breakProvider}`; cls = "text-red-300"; }
  else if (d.breakLabel) { emoji = "⛔"; txt = `Failed at ${d.breakProvider}`; cls = "text-red-300"; }
  else if (d.state === "SPEAKING") { emoji = "🔊"; txt = "AI is speaking…"; cls = "text-sky-300"; }
  else if (d.state === "UNDERSTANDING") { emoji = "🧠"; txt = "AI is thinking…"; cls = "text-amber-300"; }
  else if (d.state === "LISTENING") { emoji = "🎧"; txt = "Listening to customer…"; cls = "text-emerald-300"; }
  else if (d.ended || d.header.status === "Ended") { emoji = "✓"; txt = "Call ended"; cls = "text-gray-400"; }
  else if (d.callLevel.connected === "success") { emoji = "●"; txt = "Connected — waiting"; cls = "text-emerald-300"; }
  else if (d.callLevel.connected === "processing") { emoji = "●"; txt = "Dialing…"; cls = "text-amber-300"; }
  else if (d.lifecycle.worker === "processing" || d.lifecycle.worker === "success") { emoji = "●"; txt = "Connecting call…"; cls = "text-amber-300"; }
  else if (d.lifecycle.dispatch === "processing" || d.lifecycle.api === "processing" || d.lifecycle.request === "success") { emoji = "●"; txt = "Placing call…"; cls = "text-amber-300"; }
  else { emoji = "○"; txt = "No active call"; cls = "text-gray-500"; }
  const live = !d.breakLabel && (d.state === "SPEAKING" || d.state === "UNDERSTANDING" || d.state === "LISTENING");
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-gray-500">Current state</div>
      <div className={`mt-1 flex items-center gap-2 text-base font-semibold ${cls}`}>
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${live ? "animate-pulse" : ""}`} style={{ background: "currentColor" }} />
        <span>{emoji} {txt}</span>
      </div>
    </div>
  );
}

function RecentTurns({ turns, onPick }: { turns: Turn[]; onPick: (t: Turn) => void }) {
  const last = turns.slice(-8);
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-gray-500">Last {last.length || 8} turns</div>
      {last.length === 0 ? <div className="text-xs text-gray-600">No turns yet.</div> : (
        <div className="flex flex-wrap items-center gap-1.5">
          {last.map((t) => {
            const cause = classifyTurn(t);
            const bad = cause === "rate_limit" || cause === "llm_fragment";
            const warn = cause === "playback_cut" || cause === "pending";
            const col = bad ? "bg-red-500/80 border-red-400" : warn ? "bg-amber-500/80 border-amber-400" : "bg-emerald-500/80 border-emerald-400";
            return (
              <button key={t.n} type="button" onClick={() => onPick(t)} title={`Turn ${t.n}: ${t.caller}`}
                className={`flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1 text-[11px] font-bold text-white/90 ${col}`}>
                {bad ? "✕" : "✓"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Interactive call timeline (dependency-free SVG). X = time, Y = call duration;
// dots colored by real DB status; click selects a call. Area line connects calls
// in time order. Tooltip via native <title> (room/assistant/time/duration/status).
// A time-bucket of calls for the aggregated timeline.
type Bucket = { t: number; total: number; completed: number; active: number; failed: number; calls: CallRow[] };
function statusOf(c: CallRow): "completed" | "failed" | "active" | "other" {
  const s = (c.status || "").toUpperCase();
  if (s === "COMPLETED") return "completed";
  if (s === "FAILED" || s === "BUSY" || s === "NO_ANSWER") return "failed";
  if (s === "IN_PROGRESS" || s === "RINGING" || s === "QUEUED") return "active";
  return "other";
}
// Aggregate calls into hour/day buckets so the chart stays readable instead of a
// crowded scatter. Empty buckets between the first and last are filled with 0 so
// the area line is continuous. Granularity + bucket count are bounded.
function bucketCalls(calls: CallRow[]): { buckets: Bucket[]; gran: "hour" | "day" } {
  const rows = calls.filter((c) => c.createdAt).map((c) => ({ c, t: Date.parse(c.createdAt as string) }))
    .filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  if (rows.length === 0) return { buckets: [], gran: "hour" };
  const HOUR = 3600e3, DAY = 86400e3;
  const span = rows[rows.length - 1].t - rows[0].t;
  let step = span <= 2 * DAY ? HOUR : DAY;
  let gran: "hour" | "day" = step === HOUR ? "hour" : "day";
  const s0base = Math.floor(rows[0].t / step) * step, e0base = Math.floor(rows[rows.length - 1].t / step) * step;
  if ((e0base - s0base) / step > 40) { step = DAY; gran = "day"; }
  const map = new Map<number, Bucket>();
  for (const { c, t } of rows) {
    const k = Math.floor(t / step) * step;
    let b = map.get(k);
    if (!b) { b = { t: k, total: 0, completed: 0, active: 0, failed: 0, calls: [] }; map.set(k, b); }
    b.total++; b.calls.push(c);
    const st = statusOf(c);
    if (st === "completed") b.completed++; else if (st === "failed") b.failed++; else if (st === "active") b.active++;
  }
  const s0 = Math.floor(rows[0].t / step) * step, e0 = Math.floor(rows[rows.length - 1].t / step) * step;
  const buckets: Bucket[] = [];
  for (let k = s0; k <= e0; k += step) buckets.push(map.get(k) ?? { t: k, total: 0, completed: 0, active: 0, failed: 0, calls: [] });
  return { buckets, gran };
}
function bucketColor(b: Bucket): string {
  if (b.failed > 0) return "#f87171";
  if (b.active > 0) return "#fbbf24";
  if (b.completed > 0) return "#34d399";
  return "#6b7280";
}

function TimelineGraph({ calls, selectedRoom, onSelect }: { calls: CallRow[]; selectedRoom: string | null; onSelect: (room: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const { buckets, gran } = useMemo(() => bucketCalls(calls), [calls]);
  if (buckets.length === 0) return <div className="flex h-[200px] items-center justify-center text-sm text-gray-400">No calls recorded yet.</div>;

  const W = 1000, H = 180, PADX = 32, PADY = 16;
  const maxCount = Math.max(1, ...buckets.map((b) => b.total));
  const n = buckets.length;
  const x = (i: number) => PADX + (n === 1 ? (W - 2 * PADX) / 2 : (i / (n - 1)) * (W - 2 * PADX));
  const y = (count: number) => H - PADY - (count / maxCount) * (H - 2 * PADY);
  const coords = buckets.map((b, i) => ({ x: x(i), y: y(b.total) }));
  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L${coords[n - 1].x.toFixed(1)},${H - PADY} L${coords[0].x.toFixed(1)},${H - PADY} Z`;
  const fmtBucket = (ms: number) => gran === "hour"
    ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })
    : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const selIdx = selectedRoom != null ? buckets.findIndex((b) => b.calls.some((c) => c.room === selectedRoom)) : -1;
  // Y ticks: 0, mid, max (integers).
  const yTicks = Array.from(new Set([0, Math.round(maxCount / 2), maxCount]));
  // X ticks: up to 5 evenly spaced bucket labels.
  const xTickIdx = n <= 5 ? buckets.map((_, i) => i) : [0, 1, 2, 3, 4].map((k) => Math.round((k / 4) * (n - 1)));
  const pickLatest = (b: Bucket) => b.calls.slice().sort((a, z) => Date.parse(z.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0];

  return (
    <div>
      {/* Chart box: SVG fills it exactly, so the HTML markers (positioned as % of
          THIS box) line up with the line both horizontally and vertically. */}
      <div className="relative h-[180px]">
        {/* Y-axis labels, in the left PADX gutter (no horizontal padding). */}
        {yTicks.map((v) => (
          <span key={v} className="pointer-events-none absolute left-0 -translate-y-1/2 font-mono text-[9px] text-gray-500"
            style={{ top: `${(coords.length ? (y(v) / H) * 100 : 0)}%` }}>{v}</span>
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="vpdBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(59,130,246,0.30)" />
              <stop offset="55%" stopColor="rgba(59,130,246,0.10)" />
              <stop offset="100%" stopColor="rgba(59,130,246,0)" />
            </linearGradient>
          </defs>
          {yTicks.map((v) => (
            <line key={v} x1={PADX} x2={W - PADX} y1={y(v)} y2={y(v)} stroke="rgba(148,163,184,0.12)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={areaPath} fill="url(#vpdBlue)" />
          <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* Crisp HTML markers (perfect circles) — only non-empty buckets. */}
        {buckets.map((b, i) => {
          if (b.total === 0) return null;
          const xPct = (coords[i].x / W) * 100, yPct = (coords[i].y / H) * 100;
          const sel = i === selIdx;
          return (
            <button key={b.t} type="button" aria-label={fmtBucket(b.t)}
              onClick={() => { const c = pickLatest(b); if (c) onSelect(c.room); }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition hover:scale-125"
              style={{
                left: `${xPct}%`, top: `${yPct}%`,
                width: sel ? 14 : 10, height: sel ? 14 : 10,
                background: bucketColor(b), borderColor: sel ? "#fff" : "#0b1220",
                boxShadow: sel ? "0 0 0 3px rgba(59,130,246,0.5)" : "none",
              }} />
          );
        })}

        {/* Tooltip */}
        {hover != null && buckets[hover] && (() => {
          const b = buckets[hover];
          const rate = b.completed + b.failed > 0 ? Math.round((b.completed / (b.completed + b.failed)) * 100) : null;
          const xPct = (coords[hover].x / W) * 100, yPct = (coords[hover].y / H) * 100;
          return (
            <div className="pointer-events-none absolute z-30 w-max -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-[#0b0d20] px-3 py-2 text-[11px] shadow-xl"
              style={{ left: `${Math.min(88, Math.max(12, xPct))}%`, top: `calc(${yPct}% - 12px)` }}>
              <div className="mb-1 font-medium text-gray-100">{fmtBucket(b.t)}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-300">
                <span className="text-gray-500">Total</span><span className="text-right font-mono">{b.total}</span>
                <span className="text-emerald-400">Completed</span><span className="text-right font-mono text-emerald-300">{b.completed}</span>
                <span className="text-amber-400">Active</span><span className="text-right font-mono text-amber-300">{b.active}</span>
                <span className="text-red-400">Failed</span><span className="text-right font-mono text-red-300">{b.failed}</span>
                <span className="text-gray-500">Success</span><span className="text-right font-mono">{rate != null ? `${rate}%` : "—"}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* X-axis labels, in a sibling row (same width → aligned by %). */}
      <div className="relative mt-1.5 h-3">
        {xTickIdx.map((i) => (
          <span key={i} className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-gray-500"
            style={{ left: `${(coords[i].x / W) * 100}%` }}>{fmtBucket(buckets[i].t)}</span>
        ))}
      </div>
    </div>
  );
}

// Independent stage status (NOT a flowchart). Downstream of a break = Not Reached.
export type StageView = { status: "success" | "processing" | "failed" | "not_reached" | "idle"; error?: string; latency?: number };
export const STAGE_LABELS: Record<string, { name: string; provider: string }> = {
  request: { name: "Call Request", provider: "Browser → dialer" },
  api: { name: "Voice API", provider: "Dispatch endpoint" },
  dispatch: { name: "LiveKit Dispatch", provider: "Agent dispatch" },
  worker: { name: "Worker", provider: "Voice agent process" },
  livekit_in: { name: "LiveKit Room", provider: "Room / SIP participant" },
  vobiz: { name: "Vobiz / SIP", provider: "Telephony" },
  deepgram: { name: "Deepgram STT", provider: "Speech-to-text" },
  groq: { name: "Groq LLM", provider: "qwen/qwen3.8-27b" },
  sarvam: { name: "Sarvam TTS", provider: "Text-to-speech" },
  livekit_out: { name: "LiveKit Output", provider: "Audio publish" },
  customer_out: { name: "Customer Reply", provider: "Delivered to caller" },
};

// Which logical provider each pipeline stage belongs to, so clicking a stage
// card opens that provider's REAL recent activity. Stages with no provider
// (request = browser, api = our own endpoint) stay non-clickable.
const STAGE_PROVIDER: Record<string, string> = {
  dispatch: "livekit", worker: "livekit", livekit_in: "livekit",
  livekit_out: "livekit", customer_out: "livekit",
  vobiz: "vobiz", deepgram: "deepgram", groq: "groq", sarvam: "sarvam",
};

// Transcript turns the panel already loaded, used as corroborating evidence that
// a stage worked even if its granular events aren't in the (bounded) log table.
export type TxEvidence = { hasUser: boolean; hasAI: boolean; connected: boolean };

// Per-stage status for the cards. A stage is SUCCESS if it EVER succeeded in the
// call (events) OR the transcript/DB proves it (fixes wrong IDLE on finished
// calls). The break stage is FAILED; stages after it that never succeeded are
// NOT REACHED. Only a stage with genuinely no evidence stays IDLE.
export function stageCardView(d: Derived, key: string, reached: Record<string, boolean>, ev: TxEvidence): StageView {
  const order: string[] = FLOW_NODES.map((n) => n.key);
  const lat = flowLatency(d, key);
  const failedKey = d.breakStageKey;
  // The broken stage is RED whether it hard-failed or is stuck (per the spec).
  if (failedKey && key === failedKey) return { status: "failed", error: d.breakReason, latency: lat };
  if (flowStatus(d, key) === "processing") return { status: "processing", latency: lat };
  // Downstream of the break never reached, even if reachedFromEvents saw a
  // stray later event — the break is the root; later stages are not trustworthy.
  if (failedKey && order.indexOf(key) > order.indexOf(failedKey)) return { status: "not_reached" };
  const ever = reached[key] || (
    key === "vobiz" ? ev.connected :
    key === "livekit_in" ? ev.connected :
    key === "deepgram" ? ev.hasUser :
    key === "groq" ? ev.hasAI :
    key === "sarvam" ? ev.hasAI :
    key === "livekit_out" ? ev.hasAI :
    key === "customer_out" ? (ev.hasAI && (d.turns.length > 1 || d.ended)) : false
  );
  if (ever) return { status: "success", latency: lat };
  return { status: "idle" };
}

function StageCards({ d, reached, ev, selected, onSelect }: {
  d: Derived; reached: Record<string, boolean>; ev: TxEvidence;
  selected: string | null; onSelect: (providerKey: string) => void;
}) {
  const sty: Record<StageView["status"], { card: string; text: string; icon: string }> = {
    success: { card: "border-emerald-500/50 bg-emerald-500/[0.08]", text: "text-emerald-300", icon: "text-emerald-400" },
    processing: { card: "border-amber-500/50 bg-amber-500/[0.08]", text: "text-amber-300", icon: "text-amber-400" },
    failed: { card: "border-red-500/60 bg-red-500/[0.10]", text: "text-red-300", icon: "text-red-400" },
    not_reached: { card: "border-white/10 bg-white/[0.02]", text: "text-gray-500", icon: "text-gray-600" },
    idle: { card: "border-white/10 bg-white/[0.02]", text: "text-gray-500", icon: "text-gray-600" },
  };
  const word = (k: string, v: StageView): string => {
    if (v.status === "success") return k === "vobiz" || k === "livekit_in" ? "CONNECTED" : "COMPLETED";
    if (v.status === "failed") return "FAILED";
    if (v.status === "processing") return "PROCESSING";
    if (v.status === "not_reached") return "NOT REACHED";
    return "IDLE";
  };
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {FLOW_NODES.map((n) => {
        const v = stageCardView(d, n.key, reached, ev);
        const s = sty[v.status];
        const lab = STAGE_LABELS[n.key];
        const glyphCh = v.status === "success" ? "✓" : v.status === "failed" ? "✕" : v.status === "processing" ? "●" : "○";
        const pk = STAGE_PROVIDER[n.key];
        const isSel = !!pk && pk === selected;
        // Clickable when the stage maps to a provider — opens its recent activity.
        const Tag = pk ? "button" : "div";
        return (
          <Tag
            key={n.key}
            {...(pk ? { type: "button" as const, onClick: () => onSelect(pk), title: `View ${lab.name} recent activity` } : {})}
            className={`rounded-xl border-2 p-3 text-left ${s.card} ${pk ? "cursor-pointer hover:brightness-125" : ""} ${isSel ? "ring-2 ring-purple-400/70" : ""}`}
          >
            <div className="flex items-center gap-1.5">
              <n.Icon size={14} className={`shrink-0 ${s.icon}`} />
              <span className="truncate text-sm font-semibold text-gray-100">{lab.name}</span>
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{lab.provider}</div>
            <div className={`mt-2 text-sm font-bold ${s.text}`}>{glyphCh} {word(n.key, v)}</div>
            {v.error ? <div className="mt-1 break-words text-[11px] text-red-300">{v.error}</div>
              : v.latency != null ? (() => {
                  const b = LAT_BUDGET[n.key];
                  const slow = b && v.latency >= b.bad ? "bad" : b && v.latency >= b.warn ? "warn" : "ok";
                  const cls = slow === "bad" ? "text-red-300" : slow === "warn" ? "text-amber-300" : "text-gray-400";
                  return <div className={`mt-1 font-mono text-[11px] ${cls}`}>{Math.round(v.latency)} ms{slow !== "ok" ? " · high latency" : ""}</div>;
                })() : null}
            {v.status === "failed" && d.breakTs && <div className="mt-0.5 text-[10px] text-gray-500">Occurred {new Date(d.breakTs).toLocaleTimeString()}</div>}
            {n.key === "groq" && d.llmFallback.used && (
              <div className="mt-1 rounded bg-amber-500/15 px-1.5 py-1 text-[10px] text-amber-300">⚠ Groq failed{d.llmFallback.errorType ? ` (${d.llmFallback.errorType})` : ""} → recovered via {d.llmFallback.label ?? "fallback"}</div>
            )}
            {n.key === "groq" && !d.llmFallback.used && d.llmFallback.active && (
              <div className="mt-1 text-[10px] text-amber-300">Fallback LLM active…</div>
            )}
            {pk && <div className="mt-1.5 text-[10px] text-purple-300/80">{isSel ? "▾ showing recent activity" : "click for recent activity"}</div>}
          </Tag>
        );
      })}
    </div>
  );
}

function SystemHealthStrip({ items }: { items: { label: string; state: "ok" | "warn" | "bad" | "unknown"; detail?: string }[] }) {
  const dot = { ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400", unknown: "bg-gray-600" };
  const txt = { ok: "Healthy", warn: "Degraded", bad: "Failed", unknown: "Not checked" };
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5" title={it.detail ?? `${it.label}: ${txt[it.state]}`}>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot[it.state]} ${it.state === "warn" ? "animate-pulse" : ""}`} />
          <span className="text-xs text-gray-300">{it.label}</span>
          <span className="text-[10px] text-gray-500">{txt[it.state]}</span>
        </div>
      ))}
    </div>
  );
}


export default function VoicePipelineDiagnostics() {
  const [events, setEvents] = useState<Evt[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showTech, setShowTech] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [pickedTurn, setPickedTurn] = useState<number | null>(null);
  // Clicking a pipeline stage card opens that provider's REAL recent activity
  // directly below the cards (read-only — never triggers a provider request).
  const [stageProvider, setStageProvider] = useState<string | null>(null);
  const stageActivityRef = useRef<HTMLElement>(null);
  const stageProviderDef = PROVIDERS.find((p) => p.key === stageProvider) ?? null;
  // Shared unified stream, so new events merge into the open provider timeline.
  const { events: liveEvents, conn: liveConn } = useLiveEvents();
  const liveDisconnected = liveConn === "error" || liveConn === "closed";
  useEffect(() => {
    if (!stageProvider) return;
    const id = requestAnimationFrame(() => {
      stageActivityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [stageProvider]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selEvents, setSelEvents] = useState<Evt[] | null>(null);
  const [health, setHealth] = useState<{ api: string; database: string } | null>(null);
  const [convo, setConvo] = useState<{ found: boolean; recordingUrl?: string | null; recordingEnabled?: boolean; transcript?: { speaker: string; text: string; ts: string }[]; assistant?: { name?: string; voiceId?: string; llmProvider?: string; llmModel?: string; ttsProvider?: string; sttProvider?: string; sttModel?: string } | null } | null>(null);

  const pausedRef = useRef(false);
  const bufRef = useRef<Evt[]>([]);
  const lastRoom = useRef<string | null>(null);
  const dbIdToRoom = useRef<Record<string, string>>({});
  // Maps a pre-room call_attempt_id → the real LiveKit room, learned when an
  // event (dispatch_ok) carries both. Lets the attempt's pre-room events merge
  // into the same timeline as the worker's room-keyed events on a success.
  const attemptToRoom = useRef<Record<string, string>>({});
  // Event identities already inserted, so a redelivered SSE row is dropped
  // instead of producing a duplicate React key.
  const seenIds = useRef<Set<string>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // SSE (same pattern + 2s backoff as LiveLogs)
  useEffect(() => {
    let es: EventSource | null = null; let cancelled = false;
    const connect = () => {
      es = new EventSource("/api/logs/proxy");
      es.onopen = () => setConn("open");
      es.addEventListener("heartbeat", () => setConn("open"));
      es.addEventListener("log", (ev: MessageEvent) => {
        if (pausedRef.current) return;
        let raw: RawLog; try { raw = JSON.parse(ev.data) as RawLog; } catch { return; }
        let meta: Record<string, unknown> = {}; try { meta = raw.detail ? JSON.parse(raw.detail) : {}; } catch { meta = {}; }
        // Resolve the canonical ROOM NAME (never the DB UUID). Events that carry
        // only the UUID (call_logged) map back to their room via events that carry
        // both; otherwise inherit the last seen room.
        const metaRoom = roomNameOf(meta);
        const metaDbId = dbCallIdOf(meta);
        const attempt = num(meta.call_attempt_id);
        if (metaRoom) lastRoom.current = metaRoom;
        if (metaDbId && metaRoom) dbIdToRoom.current[metaDbId] = metaRoom;
        // Learn attempt→room and back-fill any already-buffered attempt events so
        // the pre-room lifecycle and the worker's room events form ONE call.
        let remapped = false;
        if (attempt && metaRoom && attemptToRoom.current[attempt] !== metaRoom) {
          attemptToRoom.current[attempt] = metaRoom;
          for (const ev2 of bufRef.current) if (ev2.cid === attempt) { ev2.cid = metaRoom; remapped = true; }
        }
        // cid precedence: a real room wins; else the attempt's known room; else
        // the attempt itself (pre-room grouping) — never inherit a PRIOR call's
        // room for a fresh attempt; finally the DB-UUID map, then last room.
        const cid = metaRoom
          ?? (attempt ? attemptToRoom.current[attempt] ?? attempt : null)
          ?? (metaDbId ? dbIdToRoom.current[metaDbId] ?? null : null)
          ?? lastRoom.current;
        const tsMs = raw.timestamp ? Date.parse(raw.timestamp) : Date.now();
        // Stable identity for de-dup: the persistent DB id when present, else a
        // compound key (ts + name + call_id). The SSE can redeliver the same row
        // (reconnect replays the last 20; polls overlap), which previously
        // produced duplicate React keys. Drop a row we've already inserted.
        const ident = raw.id || `${tsMs}|${String(raw.message || "")}|${cid ?? ""}`;
        if (seenIds.current.has(ident)) return;   // one backend event → one row
        seenIds.current.add(ident);
        const e: Evt = {
          id: ident, source: String(raw.source || ""), level: String(raw.level || "INFO"),
          name: String(raw.message || ""), ts: Number.isFinite(tsMs) ? tsMs : Date.now(),
          tsLabel: new Date(Number.isFinite(tsMs) ? tsMs : Date.now()).toLocaleTimeString(),
          cid, dbCallId: metaDbId, meta,
        };
        bufRef.current = [...bufRef.current.slice(-(MAX_EVENTS - 1)), e];
        // Keep the seen-set bounded to the live buffer so it can't grow forever.
        if (seenIds.current.size > MAX_EVENTS * 2) {
          seenIds.current = new Set(bufRef.current.map((x) => x.id));
        }
        // A spread makes a new array identity even when we only mutated cids
        // in place above, so React re-derives after a remap.
        setEvents(remapped ? [...bufRef.current] : bufRef.current);
      });
      es.onerror = () => {
        setConn(es && es.readyState === EventSource.CLOSED ? "error" : "closed");
        es?.close(); if (!cancelled) { setConn("connecting"); setTimeout(connect, 2000); }
      };
    };
    connect();
    return () => { cancelled = true; es?.close(); };
  }, []);

  // System health poll (API + DB)
  useEffect(() => {
    let stop = false;
    const tick = async () => { try { const r = await fetch("/api/voice/health", { cache: "no-store" }); if (!stop) setHealth(await r.json()); } catch { if (!stop) setHealth({ api: "offline", database: "unknown" }); } };
    tick(); const t = setInterval(tick, 5000); return () => { stop = true; clearInterval(t); };
  }, []);

  const currentCid = useMemo(() => { for (let i = events.length - 1; i >= 0; i--) if (events[i].cid) return events[i].cid; return null; }, [events]);
  const callEvents = useMemo(() => events.filter((e) => e.cid === currentCid), [events, currentCid]);
  const d = useMemo(() => derive(callEvents, now), [callEvents, now]);

  // Selected call: the live call by default, or a historical one picked from the
  // timeline. Historical stages are recomputed by the SAME derive() over that
  // call's persisted events (/api/voice/events) — never fabricated.
  const effectiveRoom = selectedRoom ?? currentCid;
  const viewingLive = !selectedRoom || selectedRoom === currentCid;
  const sd = useMemo(() => (viewingLive ? d : derive(selEvents ?? [], now)), [viewingLive, d, selEvents, now]);
  const effectiveEvents = useMemo(() => (viewingLive ? callEvents : (selEvents ?? [])), [viewingLive, callEvents, selEvents]);
  const selectedCall = useMemo(() => calls.find((c) => c.room === effectiveRoom) ?? null, [calls, effectiveRoom]);

  // Which stages the selected call ever reached + transcript/DB corroboration,
  // so finished calls show COMPLETED (not IDLE) and system-health reflects proof.
  const reached = useMemo(() => reachedFromEvents(effectiveEvents), [effectiveEvents]);
  const txEv = useMemo<TxEvidence>(() => {
    const hasUser = !!convo?.transcript?.some((m) => m.speaker === "CUSTOMER");
    const hasAI = !!convo?.transcript?.some((m) => m.speaker === "AI");
    const st = String(selectedCall?.status ?? sd.header.status ?? "").toUpperCase();
    const connected = hasUser || hasAI || ["IN_PROGRESS", "COMPLETED", "FAILED"].includes(st) || sd.callLevel.connected === "success" || !!reached.vobiz || !!reached.livekit_in;
    return { hasUser, hasAI, connected };
  }, [convo, selectedCall, sd, reached]);

  // Recording status (E6): only "available" once a real recordingUrl exists.
  const recStatus = useMemo<"available" | "in_progress" | "not_configured" | "unknown">(() => {
    if (convo?.recordingUrl) return "available";
    for (let i = effectiveEvents.length - 1; i >= 0; i--) {
      const n = effectiveEvents[i].name;
      if (n === "egress_started") return "in_progress";
      if (n === "egress_skipped_no_r2_config") return "not_configured";
    }
    return "unknown";
  }, [effectiveEvents, convo?.recordingUrl]);

  // Transcript + recording poll — for the SELECTED call (live or historical),
  // always by canonical LiveKit room name so Call.livekitRoomName matches.
  useEffect(() => {
    const room = selectedRoom ?? currentCid;
    let stop = false;
    const tick = async () => {
      if (!room) { if (!stop) setConvo(null); return; }
      try { const r = await fetch(`/api/voice/transcript?room=${encodeURIComponent(room)}`, { cache: "no-store" }); if (!stop) setConvo(await r.json()); } catch { /* ignore */ }
    };
    tick(); const t = setInterval(tick, 3000); return () => { stop = true; clearInterval(t); };
  }, [selectedRoom, currentCid]);

  // Recent calls for the timeline graph (polled).
  useEffect(() => {
    let stop = false;
    const tick = async () => { try { const r = await fetch("/api/voice/calls?limit=40", { cache: "no-store" }); const j = await r.json(); if (!stop && Array.isArray(j.calls)) setCalls(j.calls); } catch { /* ignore */ } };
    tick(); const t = setInterval(tick, 6000); return () => { stop = true; clearInterval(t); };
  }, []);

  // When a HISTORICAL call is selected, load its persisted events and replay them
  // through derive() for a truthful stage breakdown.
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!selectedRoom || selectedRoom === currentCid) { if (!stop) setSelEvents(null); return; }
      try { const r = await fetch(`/api/voice/events?room=${encodeURIComponent(selectedRoom)}`, { cache: "no-store" }); const j = await r.json(); if (!stop) setSelEvents(parseRawLogs(j.events ?? [], selectedRoom)); } catch { if (!stop) setSelEvents([]); }
    })();
    return () => { stop = true; };
  }, [selectedRoom, currentCid]);

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [convo?.transcript?.length]);


  // System-health inference (clearly labeled; only what we can actually observe)
  const liveLogsState: "ok" | "warn" | "bad" = conn === "open" ? "ok" : conn === "connecting" ? "warn" : "bad";
  const apiState = health?.api === "ok" ? "ok" : health?.api === "offline" ? "bad" : "unknown";
  const dbState = health?.database === "ok" ? "ok" : health?.database === "down" ? "bad" : "unknown";
  // Infra health is INDEPENDENT of a single call's failure. Only REAL in-room
  // evidence (not the browser-side pre-room lifecycle) counts toward a
  // component being Healthy — so an API 504 / dispatch failure never makes the
  // Worker/LiveKit/Telephony read Healthy, and one failed dispatch never marks
  // the Voice API down (that comes only from /api/voice/health).
  const roomEvidence = !!(reached.worker || reached.livekit_in || reached.vobiz || reached.deepgram || reached.groq || reached.sarvam || reached.livekit_out) || txEv.connected;
  const workerState: "ok" | "unknown" = (d.lastAgentEventTs && now - d.lastAgentEventTs < 90000) || roomEvidence ? "ok" : "unknown";
  const liveKitState: "ok" | "unknown" = d.callLevel.aiConnected === "success" || reached.livekit_in || txEv.connected ? "ok" : "unknown";
  const telephonyState: "ok" | "bad" | "unknown" = d.callLevel.connected === "success" || reached.vobiz || txEv.connected ? "ok" : d.callLevel.connected === "failed" ? "bad" : "unknown";

  const assistantName = d.header.assistant ?? convo?.assistant?.name ?? null;
  const voice = d.providers.voice ?? convo?.assistant?.voiceId ?? null;
  const llm = d.providers.llm ?? convo?.assistant?.llmProvider ?? null;
  const llmModel = d.providers.llmModel ?? convo?.assistant?.llmModel ?? null;
  const stt = d.providers.stt ?? convo?.assistant?.sttProvider ?? null;
  const tts = d.providers.tts ?? convo?.assistant?.ttsProvider ?? null;

  const headerTone = (s: string) => s === "Connected" ? "text-emerald-300" : s === "Failed" ? "text-red-300" : s === "Ended" ? "text-gray-400" : s === "Dialing" ? "text-amber-300" : "text-gray-400";
  const clearView = () => { bufRef.current = []; setEvents([]); lastRoom.current = null; dbIdToRoom.current = {}; seenIds.current = new Set(); setConvo(null); };
  const lastCall = d.ended || d.header.status === "Ended";

  return (
    <section className="glass rounded-2xl p-5">
      {/* title + controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <AudioLines size={16} className="text-cyan-300" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">Voice Pipeline — Live Diagnostics</h2>
          {currentCid && (
            lastCall
              ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">Last call</span>
              : <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">● Live call</span>
          )}
          {/* Active worker build (item 1). RED when the call ran on an old build —
              an old build must not be trusted as proof of the latest fix. */}
          {d.build && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] tracking-wide ${d.build === EXPECTED_BUILD ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/50 bg-red-500/15 text-red-300"}`}
              title={d.build === EXPECTED_BUILD ? "Running the expected build" : `Expected ${EXPECTED_BUILD}`}>
              {d.build === EXPECTED_BUILD ? "✓" : "✕ old worker · "}Build: {d.build}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPaused((p) => !p)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/[0.08]">{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? "Resume" : "Pause"}</button>
          <button type="button" onClick={clearView} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/[0.08]"><Trash2 size={12} /> Clear</button>
        </div>
      </div>

      {/* KPI SUMMARY — glanceable totals across all recent calls. */}
      {(() => {
        const total = calls.length;
        let completed = 0, active = 0, failed = 0, durSum = 0, durN = 0;
        for (const c of calls) {
          const st = statusOf(c);
          if (st === "completed") completed++; else if (st === "active") active++; else if (st === "failed") failed++;
          if (c.durationSeconds != null && st === "completed") { durSum += c.durationSeconds; durN++; }
        }
        const rate = completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : null;
        const avgDur = durN > 0 ? Math.round(durSum / durN) : null;
        const cards = [
          { l: "Total calls", v: String(total), tone: "text-gray-100" },
          { l: "Completed", v: String(completed), tone: "text-emerald-300" },
          { l: "Active", v: String(active), tone: "text-amber-300" },
          { l: "Failed", v: String(failed), tone: "text-red-300" },
          { l: "Success rate", v: rate != null ? `${rate}%` : "—", tone: rate == null ? "text-gray-400" : rate >= 80 ? "text-emerald-300" : rate >= 50 ? "text-amber-300" : "text-red-300" },
          { l: "Avg duration", v: avgDur != null ? `${avgDur}s` : "—", tone: "text-gray-100" },
        ];
        return (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {cards.map((c) => (
              <div key={c.l} className="rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-widest text-gray-500">{c.l}</div>
                <div className={`mt-0.5 text-xl font-semibold tabular-nums ${c.tone}`}>{c.v}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* SELECTED CALL SUMMARY — health · current/final state · result. */}
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex items-center rounded-2xl border border-white/5 bg-white/[0.02] p-3"><HealthRing d={sd} /></div>
        <div className="flex items-center rounded-2xl border border-white/5 bg-white/[0.02] p-3"><CurrentState d={sd} /></div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-gray-500">{viewingLive ? "Selected call (live)" : "Selected call"}</div>
            {!viewingLive && <button type="button" onClick={() => setSelectedRoom(null)} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/10">← Live</button>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-gray-200">
            <Bot size={14} className="shrink-0 text-purple-300" /><span className="truncate">{selectedCall?.assistant ?? assistantName ?? "—"}{(selectedCall?.voice ?? voice) ? ` · ${selectedCall?.voice ?? voice}` : ""}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs text-gray-400">
            <span>{selectedCall?.phone ?? sd.header.phone ?? "—"}</span>
            <span className="tabular-nums">{selectedCall?.durationSeconds != null ? `${selectedCall.durationSeconds}s` : secs(sd.perf.durationMs)}</span>
            <span className={`not-italic ${headerTone(selectedCall?.status ?? sd.header.status)}`}>{sd.breakLabel ? "Blocked" : (selectedCall ? callTone(selectedCall).label : sd.header.status)}</span>
          </div>
        </div>
      </div>

      {/* SELECTED CALL METADATA — compact row. */}
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        {[
          { l: "Room", v: effectiveRoom ?? "—", mono: true },
          { l: "Assistant", v: selectedCall?.assistant ?? assistantName ?? "—" },
          { l: "Voice", v: selectedCall?.voice ?? voice ?? "—" },
          { l: "LLM", v: (selectedCall?.llm ?? llm) ? `${selectedCall?.llm ?? llm}${(selectedCall?.llmModel ?? llmModel) ? `/${selectedCall?.llmModel ?? llmModel}` : ""}` : "—" },
          { l: "STT", v: selectedCall?.stt ?? stt ?? "—" },
          { l: "TTS", v: selectedCall?.tts ?? tts ?? "—" },
          { l: "Started", v: selectedCall?.createdAt ? new Date(selectedCall.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—" },
          { l: "Duration", v: selectedCall?.durationSeconds != null ? `${selectedCall.durationSeconds}s` : secs(sd.perf.durationMs) },
          { l: "Status", v: selectedCall?.status ?? sd.header.status, tone: headerTone(selectedCall?.status ?? sd.header.status) },
        ].map((c) => (
          <div key={c.l} className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-gray-500">{c.l}</div>
            <div className={`truncate ${c.mono ? "font-mono text-[11px]" : "text-sm"} ${c.tone ?? "text-gray-200"}`} title={String(c.v)}>{String(c.v)}</div>
          </div>
        ))}
      </div>

      {/* FAILURE SUMMARY — the full structured "what/where/why/when" so the
          operator never needs the WSL logs (end-to-end error monitor). */}
      {sd.fail ? (() => {
        const f = sd.fail;
        const head = f.kind === "stuck" ? "CALL STUCK" : "CALL FAILED";
        return (
          <div className="mb-4 rounded-xl border border-red-500/50 bg-red-500/10 px-3.5 py-3 text-sm text-red-200">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span className="text-[13px] font-bold tracking-wide text-red-100">{head}</span>
              <span className="rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold">Failed at: {f.stageLabel}</span>
              {f.httpStatus != null && <span className="rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-mono">HTTP {f.httpStatus}</span>}
              {f.errorType && <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-mono text-red-300">{f.errorType}</span>}
            </div>
            <div className="mt-1.5 text-[13px] text-red-100">{f.reason}</div>
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-[11px] text-red-200/80 sm:grid-cols-2">
              <span>Last successful: <span className="text-red-100">{f.lastSuccessful ?? "—"}</span></span>
              <span>Expected next: <span className="text-red-100">{f.nextExpected ?? "—"}</span></span>
              <span>When: <span className="text-red-100">{f.ts ? new Date(f.ts).toLocaleTimeString() : "—"}</span>{f.elapsedMs != null ? ` · after ${(f.elapsedMs / 1000).toFixed(1)}s` : ""}</span>
              {f.providerCode && <span>Provider code: <span className="font-mono text-red-100">{f.providerCode}</span></span>}
              {f.room && <span className="truncate" title={f.room}>Room: <span className="font-mono text-red-100">{f.room}</span></span>}
              {f.attemptId && <span className="truncate" title={f.attemptId}>Attempt: <span className="font-mono text-red-100">{f.attemptId.slice(0, 18)}</span></span>}
            </div>
          </div>
        );
      })() : (() => {
        const hasData = effectiveEvents.length > 0 && (sd.callLevel.connected !== "idle" || sd.greeting != null || sd.turns.length > 0);
        if (hasData) return <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-200"><CheckCircle2 size={15} /> No pipeline break detected{sd.turns.length ? ` · ${sd.turns.length} turn${sd.turns.length === 1 ? "" : "s"}` : ""}</div>;
        return <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-400"><Radio size={14} /> {effectiveEvents.length > 0 ? "Waiting for telemetry…" : "No pipeline events recorded for this call."}</div>;
      })()}

      {/* PIPELINE STAGES — independent status cards (NOT a flowchart). */}
      <div className="mb-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Pipeline stages</div>
        <StageCards d={sd} reached={reached} ev={txEv} selected={stageProvider} onSelect={setStageProvider} />

        {/* SELECTED STAGE'S PROVIDER — real recent activity, directly below the
            stage cards. Read-only: it loads persisted activity, never a new hit. */}
        {stageProviderDef && (
          <section ref={stageActivityRef} className="mt-3 scroll-mt-4">
            <div className="rounded-xl ring-1 ring-purple-500/30">
              <ProviderActivityPanel def={stageProviderDef} events={liveEvents} disconnected={liveDisconnected} />
            </div>
          </section>
        )}

        {sd.turns.length > 0 && <div className="mt-3"><TurnDetail t={sd.turns[sd.turns.length - 1]} /></div>}
      </div>

      {/* MAIN: Response time + recent turns + greeting  |  Live conversation */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {/* RESPONSE TIME — latency bars for the selected call's latest turn. */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Response time — {sd.ended ? "last turn" : "current turn"}</div>
            {sd.turns.length > 0 ? (() => {
              const t = sd.turns[sd.turns.length - 1];
              const rl = t.rateLimited || t.incomplete;
              const maxMs = Math.max(t.sttMs ?? 0, t.llmMs ?? 0, t.ttsMs ?? 0, t.outMs ?? 0, 200);
              return (
                <div className="space-y-1.5">
                  <PerfBar label="STT" ms={t.sttMs} max={maxMs} />
                  <PerfBar label="Groq" ms={t.llmMs} max={maxMs} failed={rl} />
                  <PerfBar label="Sarvam" ms={t.ttsMs} max={maxMs} failed={rl && t.tts !== "success"} />
                  <PerfBar label="Output" ms={t.outMs} max={maxMs} failed={rl && t.output !== "success"} />
                  <div className="flex justify-between border-t border-white/5 pt-1.5 text-[11px]"><span className="text-gray-400">TOTAL</span><span className="font-mono tabular-nums text-gray-200">{t.e2eMs != null ? `${(t.e2eMs / 1000).toFixed(2)} s` : "—"}</span></div>
                </div>
              );
            })() : <div className="text-xs text-gray-500">No turn yet.</div>}
          </div>

          {/* RECENT TURN HEALTH (item 6). */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <RecentTurns turns={sd.turns} onPick={(t) => setPickedTurn((p) => (p === t.n ? null : t.n))} />
            {pickedTurn != null && (() => {
              const t = sd.turns.find((x) => x.n === pickedTurn);
              if (!t) return null;
              const cause = CAUSE_TEXT[classifyTurn(t)];
              return <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-2 text-[11px]"><div className="text-gray-300">Turn #{t.n}: “{t.caller}”</div><div className={cause.cls}>{cause.label}</div></div>;
            })()}
          </div>

          {/* Greeting (compact). */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-1.5 text-[10px] uppercase tracking-widest text-gray-500">Greeting</div>
            {sd.greeting ? (
              <ul className="space-y-0.5 text-xs">
                <li className={sd.greeting.generated ? "text-emerald-300" : "text-gray-500"}>✓ Generated ({sd.greeting.mode})</li>
                <li className={sd.greeting.voice ? "text-emerald-300" : "text-gray-500"}>✓ Voice created</li>
                <li className={sd.greeting.failed ? "text-red-300" : sd.greeting.delivered ? "text-emerald-300" : "text-amber-300"}>{sd.greeting.failed ? "✕ Delivery failed" : sd.greeting.delivered ? `✓ Delivered${sd.greeting.interrupted ? " (interrupted)" : ""}` : "… Delivering"}</li>
              </ul>
            ) : <div className="text-xs text-gray-500">No greeting yet.</div>}
          </div>
        </div>

        {/* LIVE CONVERSATION */}
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Live conversation</div>
          {/* recording — real private player + download via the signed-URL API.
              Uses the DB-backed status by call id (works for historical calls);
              for a live call before its DB row exists, falls back to an
              event-based hint so the operator still sees recording progress. */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            {selectedCall?.id ? (
              <CallRecording callId={selectedCall.id} durationSeconds={selectedCall.durationSeconds} variant="plain" />
            ) : (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Headphones size={14} />
                {recStatus === "in_progress" ? <span className="text-amber-300">Recording in progress…</span>
                  : recStatus === "not_configured" ? "Recording not configured — set R2_* env vars (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_ENDPOINT) to enable LiveKit Egress."
                  : "Recording will appear here once the call is logged."}
              </div>
            )}
          </div>
          {/* transcript */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Live transcript</div>
            <div className="max-h-72 space-y-2 overflow-auto">
              {convo?.transcript && convo.transcript.length > 0 ? convo.transcript.map((m, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className={m.speaker === "CUSTOMER" ? "font-medium text-purple-300" : "font-medium text-cyan-300"}>{m.speaker === "CUSTOMER" ? "Customer" : "AI"}</span>
                    <span className="font-mono text-[10px] text-gray-600">{new Date(m.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-gray-300">{m.text}</div>
                </div>
              )) : <div className="text-xs text-gray-500">No transcript yet{convo && !convo.found ? " (waiting for the call row)" : ""}.</div>}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* TIMING + CALLER/AGENT AUDIO (item 13) */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Timing & barge-in</div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-gray-400">
            <span>First audio <span className="font-mono text-gray-200">{sd.perf.llmTtft != null && sd.perf.stt != null ? ms(sd.perf.stt + sd.perf.llmTtft + (sd.perf.ttsTtfb ?? 0)) : "—"}</span></span>
            <span>End-to-end <span className="font-mono text-gray-200">{sd.perf.e2e != null ? `${(sd.perf.e2e / 1000).toFixed(2)} s` : "—"}</span></span>
            <span>Interruptions <span className="font-mono text-gray-200">{sd.bargein.count}</span></span>
            <span>Resumed listening {sd.bargein.last == null ? <span className="text-gray-200">—</span> : sd.bargein.recovered ? <span className="text-emerald-300">✓</span> : <span className="text-red-300">✕ stuck</span>}</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-gray-500">Caller / agent audio</div>
          <p className="text-xs text-gray-500">Live frequency meters for caller and agent run on the <span className="text-gray-300">Calls</span> page — they need the in-browser WebRTC audio track, which only exists there. Not shown here rather than fabricating a signal.</p>
        </div>
      </div>

      {/* SYSTEM HEALTH — compact strip (item 7), not a card wall. */}
      <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500">
          System health
          {sd.build && <span className={`ml-auto rounded-full border px-2 py-0.5 normal-case tracking-normal ${sd.build === EXPECTED_BUILD ? "border-emerald-500/40 text-emerald-300" : "border-red-500/50 text-red-300"}`}>Build: {sd.build}</span>}
        </div>
        <SystemHealthStrip items={[
          { label: "Voice API", state: apiState },
          { label: "Worker", state: workerState },
          { label: "LiveKit", state: liveKitState },
          { label: "Telephony", state: telephonyState },
          { label: "Database", state: dbState },
          { label: "Live Logs", state: liveLogsState },
        ]} />
      </div>

      {/* LIVE EVENT TIMELINE — collapsed vertical timeline (item 12). */}
      <div className="mt-4">
        <button type="button" onClick={() => setShowTimeline((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 hover:bg-white/[0.08]">
          {showTimeline ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {showTimeline ? "Hide" : "Show"} event timeline
        </button>
        {showTimeline && (() => {
          const EVMAP: Record<string, { label: string; kind: Step["kind"] }> = {
            call_answered: { label: "Call answered", kind: "ok" },
            room_connected: { label: "Room connected", kind: "ok" },
            audio_frames_started: { label: "Customer speech", kind: "ok" },
            stt_final_transcript: { label: "Transcript final", kind: "ok" },
            llm_request_started: { label: "Groq request", kind: "proc" },
            llm_response_received: { label: "Groq response", kind: "ok" },
            llm_rate_limited: { label: "Groq 429 rate limit", kind: "bad" },
            incomplete_llm_response: { label: "Incomplete AI response", kind: "bad" },
            primary_llm_failed: { label: "Groq failed → fallback", kind: "bad" },
            fallback_llm_started: { label: "Fallback LLM active", kind: "proc" },
            fallback_llm_completed: { label: "Fallback LLM completed", kind: "ok" },
            fallback_llm_failed: { label: "Fallback LLM failed", kind: "bad" },
            tts_request_started: { label: "Sarvam TTS start", kind: "proc" },
            tts_audio_completed: { label: "Voice created", kind: "ok" },
            agent_audio_publish_completed: { label: "Audio sent to caller", kind: "ok" },
            session_resumed_listening: { label: "Listening resumed", kind: "ok" },
            interruption_detected: { label: "Barge-in", kind: "proc" },
            session_ended: { label: "Call ended", kind: "ok" },
          };
          const rows = effectiveEvents.filter((e) => EVMAP[e.name]).slice(-16).reverse();
          return (
            <div className="mt-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
              {rows.length === 0 ? <div className="text-xs text-gray-600">No pipeline events yet.</div> : (
                <ol className="relative space-y-1.5 border-l border-white/10 pl-4">
                  {rows.map((e) => {
                    const mm = EVMAP[e.name];
                    return (
                      <li key={e.id} className="text-[11px]">
                        <span className="absolute -left-[5px] mt-1 inline-block h-2 w-2 rounded-full" style={{ background: mm.kind === "ok" ? "#34d399" : mm.kind === "bad" ? "#f87171" : "#fbbf24" }} />
                        <span className="font-mono tabular-nums text-gray-500">{e.tsLabel}</span>
                        <span className={`ml-2 ${mm.kind === "ok" ? "text-emerald-300" : mm.kind === "bad" ? "text-red-300" : "text-amber-300"}`}>{mm.kind === "ok" ? "✓" : mm.kind === "bad" ? "✕" : "●"} {mm.label}</span>
                        <span className="ml-2 text-[10px] text-gray-600">{e.name}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })()}
      </div>

      {/* ADVANCED TECHNICAL LOGS (raw events, collapsed) */}
      <div className="mt-3">
        <button type="button" onClick={() => setShowTech((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 hover:bg-white/[0.08]">
          {showTech ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {showTech ? "Hide" : "Show"} advanced technical logs
          <span className={`ml-1 inline-flex items-center gap-1 text-[10px] ${conn === "open" ? "text-emerald-400" : "text-amber-400"}`}>{conn === "open" ? <Wifi size={11} /> : <WifiOff size={11} />}{conn === "open" ? "live" : conn}</span>
        </button>
        {showTech && (
          <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-white/5">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 bg-[#0b0d20]">
                <tr className="text-[10px] uppercase tracking-widest text-gray-500">
                  <th className="px-3 py-1.5 font-medium">Time</th><th className="px-3 py-1.5 font-medium">Provider</th>
                  <th className="px-3 py-1.5 font-medium">Event</th><th className="px-3 py-1.5 font-medium">Detail</th><th className="px-3 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {effectiveEvents.slice(-60).reverse().map((e) => {
                  const det = num(e.meta.text) ?? num(e.meta.error) ?? num(e.meta.new) ?? num(e.meta.phone) ?? "";
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-1 font-mono text-gray-500">{e.tsLabel}</td>
                      <td className="whitespace-nowrap px-3 py-1 text-gray-400">{e.source || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1 text-gray-200">{e.name}</td>
                      <td className="max-w-[260px] truncate px-3 py-1 text-gray-400" title={det}>{det}</td>
                      <td className="px-3 py-1">{e.level === "ERROR" ? <XCircle size={13} className="text-red-300" /> : <CheckCircle2 size={13} className="text-emerald-400/70" />}</td>
                    </tr>
                  );
                })}
                {effectiveEvents.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-600">Waiting for call events…</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
