"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pause, Play, Search, Trash2, Copy, Check, ArrowDown, Wifi, WifiOff, ChevronRight,
} from "lucide-react";

type Status = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";
type Log = {
  id: string;            // stable UNIQUE fingerprint (also the React key)
  source: string;
  level: string;
  status: Status;
  message: string;
  detail?: string;
  timestamp: string;
  ts: number;            // parsed ms
  category: Category;
  meta: Record<string, unknown> | null;
  synthetic?: boolean;   // UI/frontend event (ephemeral, never from the DB)
};

type ConnState = "connecting" | "reconnecting" | "open" | "closed" | "error";
type Category =
  | "UI" | "CAMPAIGN" | "CALL" | "SIP" | "STT" | "LLM" | "TTS"
  | "AUDIO" | "TOOL" | "BOOKING" | "API" | "DATABASE" | "WORKER"
  | "SYSTEM" | "ERROR";

const MAX_BUFFER = 3000;
const CONN_LABEL: Record<ConnState, string> = {
  connecting: "CONNECTING", reconnecting: "RECONNECTING", open: "CONNECTED",
  closed: "DISCONNECTED", error: "DISCONNECTED",
};

// Filter chips: All + Errors/Warnings quick filters + every category.
type FilterKey = Category | "ALL" | "ERRORS" | "WARNINGS";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "All" }, { key: "ERRORS", label: "Errors" }, { key: "WARNINGS", label: "Warnings" },
  { key: "UI", label: "UI" }, { key: "CAMPAIGN", label: "Campaign" }, { key: "CALL", label: "Calls" },
  { key: "SIP", label: "SIP" }, { key: "STT", label: "STT" }, { key: "LLM", label: "LLM" },
  { key: "TTS", label: "TTS" }, { key: "AUDIO", label: "Audio" }, { key: "TOOL", label: "Tools" },
  { key: "BOOKING", label: "Booking" }, { key: "API", label: "API" }, { key: "DATABASE", label: "Database" },
  { key: "WORKER", label: "Worker" }, { key: "SYSTEM", label: "System" },
];

const CAT_STYLE: Record<Category, string> = {
  UI: "bg-sky-500/15 text-sky-300", CAMPAIGN: "bg-fuchsia-500/15 text-fuchsia-300",
  CALL: "bg-indigo-500/15 text-indigo-300", SIP: "bg-teal-500/15 text-teal-300",
  STT: "bg-cyan-500/15 text-cyan-300", LLM: "bg-amber-500/15 text-amber-300",
  TTS: "bg-emerald-500/15 text-emerald-300", AUDIO: "bg-lime-500/15 text-lime-300",
  TOOL: "bg-violet-500/15 text-violet-300", BOOKING: "bg-pink-500/15 text-pink-300",
  API: "bg-orange-500/15 text-orange-300", DATABASE: "bg-slate-500/15 text-slate-300",
  WORKER: "bg-blue-500/15 text-blue-300", SYSTEM: "bg-white/10 text-gray-300",
  ERROR: "bg-red-500/20 text-red-300",
};
const STATUS_DOT: Record<Status, string> = {
  INFO: "bg-gray-500", SUCCESS: "bg-emerald-400", WARNING: "bg-yellow-400",
  ERROR: "bg-red-500", CRITICAL: "bg-red-400 ring-2 ring-red-500/40",
};

// One deterministic time formatter (FIXED locale + hour12) so SSR and client
// produce identical text — the environment-default-locale mismatch is the
// lowercase-"pm" vs uppercase-"PM" hydration-error source. Used everywhere.
const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
});

function parseMeta(detail?: string): Record<string, unknown> | null {
  if (!detail) return null;
  try { const o = JSON.parse(detail); return o && typeof o === "object" ? o : null; } catch { return null; }
}
function mf(meta: Record<string, unknown> | null, ...keys: string[]): string {
  if (!meta) return "";
  for (const k of keys) { const v = meta[k]; if (v != null && v !== "") return String(v); }
  return "";
}

// Fine-grained sources that unambiguously name a category — honored directly.
// NOT WORKER / API / SYSTEM / ERROR: those are coarse (the voice-service bridge
// stamps source="WORKER" on EVERY untagged agent.py event and "API" on every
// server.py event), so for them we let the message heuristics refine first and
// only fall back to WORKER/API at the end. (Audit: observability._bridge_processor
// → _SOURCE_MAP={agent:WORKER, server:API}; STT/LLM/TTS/LIVEKIT/VOBIZ are passed
// explicitly via source= on the call site.)
const FINE_SOURCE = new Set<string>(["UI", "CAMPAIGN", "CALL", "SIP", "STT", "LLM", "TTS", "AUDIO", "TOOL", "BOOKING", "DATABASE"]);

// Map raw source+message+level → one Live Logs category. Errored events keep
// their REAL category (STT/TTS/…) — the red status dot + the "Errors" filter key
// off `status`, not category, so the per-call pipeline can still attribute a
// failure to its stage.
function categorize(source: string, message: string, level: string): Category {
  const s = (source || "").toUpperCase();
  if (FINE_SOURCE.has(s)) return s as Category;   // precise source (frontend bus or explicit backend source=)
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

// Derive a display status from level + event wording.
function deriveStatus(level: string, message: string): Status {
  const L = level.toUpperCase();
  if (L === "CRITICAL") return "CRITICAL";
  if (L === "ERROR") return "ERROR";
  if (L === "WARNING" || L === "WARN") return "WARNING";
  const m = message.toLowerCase();
  if (m.includes("_failed") || m.includes("error") || m.includes("crash") || m.includes("exception") || m.includes("rejected")) return "ERROR";
  if (m.includes("completed") || m.includes("_ok") || m.includes("success") || m.includes("connected") || m.includes("locked") || m.includes("started") && m.includes("ok")) return "SUCCESS";
  return "INFO";
}

/**
 * Parse a server timestamp as UTC.
 *
 * error_logs stores NAIVE UTC, and the stream emits `ts.isoformat()` —
 * "2026-10-16T06:24:35.123456", with no timezone suffix. ECMAScript parses a
 * date-time form without an offset as LOCAL time, so on an IST (+05:30) host
 * every event was read as 5.5 hours in the past and then discarded by the
 * session-boundary check below. That is why the page showed CONNECTED with
 * EVENTS 0 while the stream was in fact delivering events correctly. On a UTC
 * host the offset is zero, which is why it never appeared in development.
 *
 * Timestamps that already carry Z or an explicit offset are left untouched.
 */
function parseUtcTs(value: string): number {
  const v = String(value).trim();
  const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(v);
  const n = Date.parse(hasZone ? v : v + "Z");
  return Number.isFinite(n) ? n : Date.now();
}

export default function LiveLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [callFilter, setCallFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [connErr, setConnErr] = useState("");      // exact last connection error (never masked)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);  // 1s ticker for "age" (client-only)
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Live session boundary. The start time is a browser-runtime concept and MUST
  // NOT be computed during render (SSR clock/locale ≠ client → hydration
  // mismatch). The REF drives the boundary filter (not rendered → safe to seed);
  // the STATE drives the label — null until a mount effect sets it, so SSR and
  // first client render both show the deterministic placeholder.
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const bufferRef = useRef<Log[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const sessionStartRef = useRef<number>(0);
  const sessionIdRef = useRef<string>("");
  const pausedRef = useRef(paused);
  const autoScrollRef = useRef(autoScroll);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  // Create (or reset) the live session — client-only, after mount. Runs on mount
  // and on "Clear live view"; never on rerender/log/filter change.
  const startSession = useCallback(() => {
    const now = Date.now();
    sessionStartRef.current = now;
    sessionIdRef.current = crypto.randomUUID?.() ?? String(now);
    setStartedAt(now);
  }, []);
  useEffect(() => { startSession(); }, [startSession]);   // before the SSE effect

  // Insert one normalized event — honoring the session boundary + fingerprint dedup.
  const ingest = useCallback((raw: { source?: string; level?: string; message?: string; detail?: string; timestamp?: string; synthetic?: boolean }) => {
    if (pausedRef.current) return;
    const ts = raw.timestamp ? parseUtcTs(raw.timestamp) : Date.now();
    const tsMs = Number.isFinite(ts) ? ts : Date.now();
    // SESSION BOUNDARY: drop events from before this session (kills the SSE
    // replay of historical rows). Synthetic events carry "now" → always pass.
    if (!raw.synthetic && tsMs < sessionStartRef.current - 250) return;
    const source = String(raw.source || "");
    const level = String(raw.level || "INFO");
    const message = String(raw.message || "");
    const meta = parseMeta(raw.detail);
    // Stable fingerprint (dedupe + React key) — never event.id alone.
    const fp = [raw.timestamp || tsMs, message, mf(meta, "call_id"), mf(meta, "campaign_id"),
                mf(meta, "job_id"), mf(meta, "turn_id"), mf(meta, "provider"), source].join("|");
    if (seenRef.current.has(fp)) return;
    seenRef.current.add(fp);
    if (seenRef.current.size > MAX_BUFFER * 2) seenRef.current = new Set(bufferRef.current.map((x) => x.id));
    const log: Log = {
      id: fp, source, level, status: deriveStatus(level, message), message, detail: raw.detail,
      timestamp: raw.timestamp || new Date(tsMs).toISOString(), ts: tsMs,
      category: categorize(source, message, level), meta, synthetic: raw.synthetic,
    };
    bufferRef.current = [...bufferRef.current.slice(-(MAX_BUFFER - 1)), log];
    setLogs(bufferRef.current);
    setLastEventAt(Date.now());
    if (!autoScrollRef.current) setNewCount((c) => c + 1);
  }, []);

  // REPLAY: seed from the durable store so a refresh shows recent history
  // instead of an empty page. Without this the operator could not distinguish
  // "idle" from "ingestion broken" — both rendered as zero events.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/logs/recent?limit=50", { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!j?.ok) { setConnErr((p) => p || String(j?.error || "log store unreachable")); return; }
        for (const ev of j.events ?? []) {
          // `synthetic: true` only to bypass the session-boundary filter —
          // these are real persisted rows, flagged `replayed` for the UI.
          ingest({ ...ev, synthetic: true });
        }
      } catch {
        if (!cancelled) setConnErr((p) => p || "could not load recent history");
      }
    })();
    return () => { cancelled = true; };
  }, [ingest]);

  // SSE — backend events. Passes ?since=<session start> so the server never
  // replays pre-session history (req 14). Reconnects with backoff on error and
  // surfaces the exact failure (req 5 — never mask DISCONNECTED).
  useEffect(() => {
    let es: EventSource | null = null; let cancelled = false; let attempt = 0;
    const connect = () => {
      if (cancelled) return;
      const since = new Date(sessionStartRef.current || Date.now()).toISOString();
      setConn(attempt === 0 ? "connecting" : "reconnecting");
      es = new EventSource(`/api/logs/proxy?since=${encodeURIComponent(since)}`);
      es.onopen = () => { attempt = 0; setConn("open"); setConnErr(""); };
      es.addEventListener("log", (e: MessageEvent) => { try { ingest(JSON.parse(e.data)); } catch { /* ignore */ } });
      es.addEventListener("heartbeat", () => { setConn("open"); setConnErr(""); });
      es.addEventListener("error", (e: MessageEvent) => { if (e?.data) setConnErr(String(e.data).slice(0, 200)); });
      es.onerror = () => {
        const closed = es && es.readyState === EventSource.CLOSED;
        es?.close();
        attempt += 1;
        setConn(closed ? "error" : "reconnecting");
        setConnErr((prev) => prev || (closed ? "stream closed by server (check voice API / auth token)" : "connection interrupted — reconnecting"));
        if (!cancelled) setTimeout(connect, Math.min(2000 * attempt, 10000));
      };
    };
    connect();
    return () => { cancelled = true; es?.close(); };
  }, [ingest]);

  // 1s ticker for "last event age" — client-only (set after mount, hydration-safe).
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Ephemeral frontend events from lib/liveBus (nav, UI actions, frontend/API errors).
  useEffect(() => {
    const onBus = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      ingest({
        source: d.category || "UI", level: d.level || "INFO", message: d.event || "ui_event",
        detail: JSON.stringify({ ...(d.detail || {}), _origin: "frontend" }),
        timestamp: new Date(d.ts || Date.now()).toISOString(), synthetic: true,
      });
    };
    window.addEventListener("jj-live-log", onBus);
    return () => window.removeEventListener("jj-live-log", onBus);
  }, [ingest]);

  // Auto-scroll when parked at the bottom.
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
    if (atBottom) setNewCount(0);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cf = callFilter.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter === "ERRORS") { if (l.status !== "ERROR" && l.status !== "CRITICAL") return false; }
      else if (filter === "WARNINGS") { if (l.status !== "WARNING") return false; }
      else if (filter !== "ALL") { if (l.category !== filter) return false; }
      if (cf) {
        const corr = `${mf(l.meta, "call_id")} ${mf(l.meta, "room", "room_id")} ${mf(l.meta, "campaign_id")} ${mf(l.meta, "assistant_id", "assistant")} ${mf(l.meta, "provider")}`.toLowerCase();
        if (!corr.includes(cf)) return false;
      }
      if (!q) return true;
      return l.message.toLowerCase().includes(q) || (l.detail?.toLowerCase().includes(q) ?? false) || l.source.toLowerCase().includes(q) || l.category.toLowerCase().includes(q);
    });
  }, [logs, search, filter, callFilter]);

  // Top summary.
  const summary = useMemo(() => {
    let campaign = "", call = "", lastErr = "", errCount = 0;
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if (l.status === "ERROR" || l.status === "CRITICAL") {
        errCount++;
        if (!lastErr) lastErr = `${l.message}${mf(l.meta, "error_type", "http_status") ? " (" + mf(l.meta, "error_type", "http_status") + ")" : ""}`;
      }
      if (!call) call = mf(l.meta, "call_id", "room");
      if (!campaign) campaign = mf(l.meta, "campaign_id");
    }
    return { campaign, call, lastErr, errCount };
  }, [logs]);

  // Per-call pipeline: stage reached/failed per call_id.
  const pipelines = useMemo(() => {
    const STAGES = ["SIP", "STT", "LLM", "TTS", "AUDIO"];
    const byCall: Record<string, { order: number; stages: Record<string, "ok" | "fail" | "none">; err?: string }> = {};
    let n = 0;
    for (const l of logs) {
      const cid = mf(l.meta, "call_id", "room");
      if (!cid) continue;
      if (!byCall[cid]) byCall[cid] = { order: n++, stages: { SIP: "none", STT: "none", LLM: "none", TTS: "none", AUDIO: "none" } };
      const p = byCall[cid];
      const c = l.category; const isErr = l.status === "ERROR" || l.status === "CRITICAL";
      if (c === "SIP" || l.message.includes("call_answered") || l.message.includes("room_connected")) p.stages.SIP = p.stages.SIP === "fail" ? "fail" : "ok";
      if (c === "STT" && !isErr) p.stages.STT = p.stages.STT === "fail" ? "fail" : "ok";
      if (c === "LLM" && !isErr) p.stages.LLM = "ok";
      if (c === "TTS" && !isErr) p.stages.TTS = "ok";
      if (c === "AUDIO" && !isErr) p.stages.AUDIO = "ok";
      if (isErr) {
        const src = (l.source || "").toUpperCase();
        if (src === "STT" || c === "STT") p.stages.STT = "fail";
        else if (src === "TTS" || c === "TTS") p.stages.TTS = "fail";
        else if (src === "LLM" || c === "LLM") p.stages.LLM = "fail";
        else if (src === "LIVEKIT" || c === "AUDIO") p.stages.AUDIO = "fail";
        p.err = `${l.message}${mf(l.meta, "http_status", "error_type") ? " · " + mf(l.meta, "http_status", "error_type") : ""}`;
      }
    }
    return Object.entries(byCall).sort((a, b) => a[1].order - b[1].order);
  }, [logs]);

  // Automatic breakpoint (req 9/10): the latest call's FIRST failed stage, derived
  // from actual event order (never guessed). Downstream stages read NOT REACHED.
  const breakpoint = useMemo(() => {
    if (pipelines.length === 0) return null;
    const [cid, p] = pipelines[pipelines.length - 1];
    const order = ["SIP", "STT", "LLM", "TTS", "AUDIO"];
    let failed: string | null = null;
    for (const s of order) { if (p.stages[s] === "fail") { failed = s; break; } }
    if (!failed) return null;
    let rootCause = p.err || `${failed} failed`;
    let impact = "";
    for (let i = logs.length - 1; i >= 0; i--) {
      const l = logs[i];
      if ((l.status === "ERROR" || l.status === "CRITICAL") && mf(l.meta, "call_id", "room") === cid) {
        rootCause = `${l.message}${mf(l.meta, "http_status") ? ` (HTTP ${mf(l.meta, "http_status")})` : ""}`;
        impact = mf(l.meta, "impact");
        break;
      }
    }
    return { call: cid, stage: failed, rootCause, impact };
  }, [pipelines, logs]);

  const toggleExpanded = (id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onClear = () => {
    bufferRef.current = []; seenRef.current = new Set(); setLogs([]); setExpanded(new Set()); setNewCount(0);
    startSession();   // new boundary + start time; DB history untouched
  };

  const jumpToLatest = () => { setAutoScroll(true); setNewCount(0); scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); };

  const onCopy = async () => {
    const text = filtered.map((l) => `[${new Date(l.ts).toISOString()}] ${l.status.padEnd(8)} ${l.category.padEnd(9)} ${l.message}${l.detail ? " | " + l.detail : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const startedLabel = startedAt == null ? "Starting live session…" : TIME_FMT.format(startedAt);
  const ageLabel = lastEventAt == null || nowMs == null ? "—" : `${Math.max(0, Math.round((nowMs - lastEventAt) / 1000))}s ago`;
  const connTone: "err" | "ok" | undefined = conn === "open" ? "ok" : (conn === "connecting" || conn === "reconnecting") ? undefined : "err";

  return (
    <div className="space-y-3">
      {/* TOP SUMMARY */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs sm:grid-cols-6">
        <Stat label="Connection" value={CONN_LABEL[conn]} mono title={connErr || undefined} tone={connTone} />
        <Stat label="Live session" value={startedLabel} mono />
        <Stat label="Events" value={String(logs.length)} mono />
        <Stat label="Last event" value={ageLabel} mono />
        <Stat label="Active call" value={summary.call || summary.campaign || "—"} mono title={summary.call || summary.campaign} />
        <Stat label={`Errors (${summary.errCount})`} value={summary.lastErr || "None"} mono title={summary.lastErr} tone={summary.lastErr ? "err" : "ok"} />
      </div>

      {/* CONNECTION ERROR (never masked) */}
      {connErr && conn !== "open" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-300">
          <span className="font-semibold">{CONN_LABEL[conn]}:</span> {connErr}
        </div>
      )}

      {/* AUTOMATIC BREAKPOINT (req 9/10) */}
      {breakpoint && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-xs">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">Breakpoint: {breakpoint.stage}</span>
            <span className="truncate font-mono text-gray-500" title={breakpoint.call}>{breakpoint.call}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            {["CALL", "LIVEKIT", "SIP", "STT", "LLM", "TTS", "AUDIO"].map((st) => {
              const order = ["SIP", "STT", "LLM", "TTS", "AUDIO"];
              const bi = order.indexOf(breakpoint.stage);
              const si = order.indexOf(st);
              let glyph = "✅", cls = "text-emerald-300";
              if (st === breakpoint.stage) { glyph = "❌"; cls = "text-red-300"; }
              else if (si > bi && bi >= 0) { glyph = "⏸"; cls = "text-gray-600"; }   // not reached
              return <span key={st} className={cls}>{st}&nbsp;{glyph}</span>;
            })}
          </div>
          <div className="mt-1 text-gray-300"><span className="text-gray-500">ROOT CAUSE:</span> {breakpoint.rootCause}</div>
          {breakpoint.impact && <div className="text-gray-400"><span className="text-gray-500">IMPACT:</span> {breakpoint.impact}</div>}
        </div>
      )}

      {/* PER-CALL PIPELINE */}
      {pipelines.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Calls in this session ({pipelines.length})</div>
          <div className="space-y-1.5">
            {pipelines.map(([cid, p]) => (
              <div key={cid} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="w-44 shrink-0 truncate font-mono text-gray-400" title={cid}>{cid}</span>
                {["SIP", "STT", "LLM", "TTS", "AUDIO"].map((st) => {
                  const v = p.stages[st];
                  const glyph = v === "ok" ? "✅" : v === "fail" ? "❌" : "○";
                  const cls = v === "ok" ? "text-emerald-300" : v === "fail" ? "text-red-300" : "text-gray-600";
                  return <span key={st} className={`font-mono ${cls}`}>{st}&nbsp;{glyph}</span>;
                })}
                {p.err && <span className="truncate text-red-300/80" title={p.err}>· {p.err}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONTROLS */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-wide ${conn === "open" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : conn === "connecting" || conn === "reconnecting" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`} title={connErr ? `SSE: ${conn} — ${connErr}` : `SSE: ${conn}`}>
          {conn === "closed" || conn === "error" ? <WifiOff size={10} /> : <Wifi size={10} />}{CONN_LABEL[conn]}
        </span>
        <button type="button" onClick={() => setPaused((p) => !p)} className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 ${paused ? "text-amber-300" : "text-gray-300"}`}>
          {paused ? <Play size={12} /> : <Pause size={12} />}{paused ? "Resume" : "Pause"}
        </button>
        <input type="search" value={callFilter} onChange={(e) => setCallFilter(e.target.value)} placeholder="call_id / campaign / assistant / provider…" aria-label="Filter by correlation id" className="w-[210px] rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40" />
        <div className="relative min-w-[140px] max-w-xs flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search message / error / event…" className="w-full rounded-lg border border-white/10 bg-black/40 pl-7 pr-2 py-1 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40" />
        </div>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/10" title="Copy filtered logs">
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={onClear} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-amber-300" title="Start a new live session (does NOT delete history)">
          <Trash2 size={12} />Clear live view
        </button>
        <span className="ml-auto text-[10px] font-mono text-gray-500">{filtered.length}{filtered.length !== logs.length && <span className="text-gray-600"> / {logs.length}</span>}<span className="text-gray-600"> shown</span></span>
      </div>

      {/* FILTER CHIPS */}
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wide transition ${filter === f.key ? "border-purple-500/50 bg-purple-500/15 text-purple-200" : "border-white/15 text-gray-400 hover:bg-white/5"}`}>{f.label}</button>
        ))}
      </div>

      {/* TIMELINE TABLE */}
      <div className="relative">
        {/* Column header */}
        <div className="grid grid-cols-[92px_16px_84px_90px_minmax(0,1fr)_64px] gap-2 rounded-t-2xl border border-b-0 border-white/10 bg-white/[0.03] px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest text-gray-500">
          <span>Time</span><span></span><span>Category</span><span>Source</span><span>Event · Message</span><span className="text-right">Latency</span>
        </div>
        <div ref={scrollRef} onScroll={onScroll} className="h-[54vh] overflow-y-auto rounded-b-2xl border border-white/10 bg-black/40 font-mono text-xs">
          {filtered.length === 0 && (
            <div className="p-4 text-gray-500">{logs.length === 0 ? "Live session started — waiting for activity…" : "No events match the current filter."}</div>
          )}
          {filtered.map((l) => {
            const corr = mf(l.meta, "call_id", "room", "campaign_id");
            const latency = mf(l.meta, "latency_ms", "total_ms", "elapsed_ms");
            const isOpen = expanded.has(l.id);
            const tsLabel = `${TIME_FMT.format(l.ts)}.${String(l.ts % 1000).padStart(3, "0")}`;
            const isErr = l.status === "ERROR" || l.status === "CRITICAL";
            return (
              <div key={l.id} className={`border-b border-white/5 ${isErr ? "bg-red-500/[0.04]" : ""}`}>
                <button type="button" onClick={() => toggleExpanded(l.id)} className="grid w-full grid-cols-[92px_16px_84px_90px_minmax(0,1fr)_64px] items-start gap-2 px-3 py-1 text-left hover:bg-white/5">
                  <span className="truncate text-gray-600" title={new Date(l.ts).toISOString()}>{tsLabel}</span>
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[l.status]}`} title={l.status} />
                  <span className={`truncate rounded px-1 text-center text-[10px] uppercase tracking-wide ${CAT_STYLE[l.category]}`}>{l.category}</span>
                  <span className="truncate text-gray-500" title={l.source}>{l.source || "—"}</span>
                  <span className={`min-w-0 break-words ${isErr ? "text-red-300" : l.status === "WARNING" ? "text-yellow-300" : l.status === "SUCCESS" ? "text-emerald-300/90" : "text-gray-300"}`}>
                    {l.synthetic && <span className="mr-1 text-sky-400">▸</span>}
                    <span className="font-semibold">{l.message}</span>
                    {corr && <span className="ml-2 text-gray-600">{corr}</span>}
                    {l.meta && <ChevronRight size={11} className={`ml-1 inline text-gray-600 transition-transform ${isOpen ? "rotate-90" : ""}`} />}
                  </span>
                  <span className="truncate text-right tabular-nums text-gray-500">{latency ? `${latency}ms` : ""}</span>
                </button>
                {isOpen && l.meta && (
                  <div className="px-3 pb-2">
                    {/* Root-cause context block */}
                    <div className="ml-[108px] grid gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2">
                      {metaRows(l).map(([k, v]) => (
                        <div key={k} className="flex gap-2"><span className="w-28 shrink-0 text-gray-600">{k}</span><span className="min-w-0 break-words text-gray-300">{v}</span></div>
                      ))}
                    </div>
                    {mf(l.meta, "stack") && (
                      <pre className="ml-[108px] mt-1 overflow-x-auto rounded-lg border border-red-500/20 bg-black/60 p-2 text-[10px] text-red-300/80">{mf(l.meta, "stack")}</pre>
                    )}
                    <pre className="ml-[108px] mt-1 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-2 text-[10px] text-gray-400">{JSON.stringify(l.meta, null, 2)}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {(!autoScroll || newCount > 0) && (
          <button type="button" onClick={jumpToLatest} className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/20 px-3 py-1 text-[10px] text-purple-100 backdrop-blur hover:bg-purple-500/30">
            <ArrowDown size={10} /> {newCount > 0 ? `${newCount} new event${newCount > 1 ? "s" : ""}` : "Jump to latest"}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, mono, title, tone }: { label: string; value: string; mono?: boolean; title?: string; tone?: "err" | "ok" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`truncate ${mono ? "font-mono" : ""} ${tone === "err" ? "text-red-300" : tone === "ok" ? "text-emerald-300" : "text-gray-200"}`} title={title}>{value}</div>
    </div>
  );
}

// The human-readable "what/where/why/impact" rows for an expanded event — only
// the correlation/diagnostic fields that are present, in a sensible order.
function metaRows(l: Log): [string, string][] {
  const m = l.meta; if (!m) return [];
  const order: [string, string[]][] = [
    ["Status", ["status"]], ["Impact", ["impact"]], ["Call", ["call_id", "room", "room_id"]],
    ["Campaign", ["campaign_id"]], ["Assistant", ["assistant_id", "assistant"]], ["Job", ["job_id"]],
    ["Turn", ["turn_id"]], ["Provider", ["provider"]], ["Model", ["model"]], ["Tool", ["tool"]],
    ["Language", ["language", "stt_language"]], ["Endpoint", ["endpoint"]], ["Method", ["method"]],
    ["HTTP", ["http_status"]], ["Route", ["route"]], ["Latency", ["latency_ms", "total_ms", "elapsed_ms"]],
    ["Retryable", ["retryable"]], ["Stage", ["stage"]], ["Next expected", ["next_expected"]],
    ["Error", ["error", "error_type", "reason"]],
  ];
  const rows: [string, string][] = [];
  for (const [label, keys] of order) {
    const v = mf(m, ...keys);
    if (v) rows.push([label, label === "Latency" ? `${v}ms` : v]);
  }
  return rows;
}
