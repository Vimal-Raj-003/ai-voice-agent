"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, ChevronRight } from "lucide-react";
import {
  parseRawLogs, derive, reachedFromEvents, stageCardView, flowLatency,
  FLOW_NODES, STAGE_LABELS,
  type RawLog, type Evt, type StageView,
} from "./VoicePipelineDiagnostics";

// Per-call logs: call flow, breakpoint/root-cause and the full event timeline.
// It reuses the SAME derive()/stageCardView() the live Voice Pipeline panel uses,
// so a historical call is scored identically — no second source of truth and no
// fabricated statuses. Events come from /api/voice/events?room=… which filters
// error_logs to THIS call's room only.

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
});
const clock = (ms: number | null | undefined) => (ms ? TIME.format(ms) : "—");

// Event names that prove a stage was reached — mirrors reachedFromEvents() so a
// stage's timestamp is taken from a REAL event, never invented.
const STAGE_EVENTS: Record<string, string[]> = {
  request: ["call_attempt_started", "voice_api_ok", "dispatch_ok"],
  api: ["voice_api_ok", "dispatch_ok"],
  dispatch: ["dispatch_ok"],
  worker: ["worker_job_received"],
  livekit_in: ["room_connected", "sip_participant_found", "sip_audio_track_subscribed", "agent_input_attached"],
  vobiz: ["dialing_out", "call_answered"],
  deepgram: ["stt_final_transcript", "stt_partial_transcript", "stt_connected", "stt_runtime_config"],
  groq: ["llm_response_received", "llm_response_completed", "primary_llm_started"],
  sarvam: ["tts_audio_completed", "tts_request_started", "tts_primary_configured"],
  livekit_out: ["agent_audio_publish_started", "agent_audio_publish_completed"],
  customer_out: ["agent_audio_publish_completed"],
};

// derive() is tuned for LIVE calls and can return no breakpoint for a historical
// one. When that happens we locate the EARLIEST error event that maps to a
// pipeline stage and treat it as the break — derived from real events, never
// invented. Order matters (most specific first).
const ERROR_STAGE: [RegExp, string][] = [
  [/^stt_|deepgram|keyterm/i, "deepgram"],
  [/^llm_|groq|qwen|fallback_llm|primary_llm/i, "groq"],
  [/^tts_|sarvam|synthes/i, "sarvam"],
  [/audio_publish|playout|agent_audio/i, "livekit_out"],
  [/sip|dial|vobiz|call_failed|answered/i, "vobiz"],
  [/room|participant|track|roomio/i, "livekit_in"],
  [/worker|job|entrypoint|session/i, "worker"],
  [/dispatch/i, "dispatch"],
];

const WORD: Record<StageView["status"], { t: string; cls: string }> = {
  success: { t: "SUCCESS", cls: "text-emerald-300" },
  processing: { t: "PROCESSING", cls: "text-amber-300" },
  failed: { t: "FAILED", cls: "text-red-300" },
  not_reached: { t: "NOT REACHED", cls: "text-gray-500" },
  idle: { t: "IDLE", cls: "text-gray-500" },
};

function evStatus(e: Evt): { t: string; cls: string } {
  const lvl = (e.level || "").toUpperCase();
  if (lvl === "ERROR" || lvl === "CRITICAL") return { t: "ERROR", cls: "text-red-300" };
  if (lvl === "WARNING") return { t: "WARN", cls: "text-yellow-300" };
  if (/_completed|_connected|_ok$|success|answered/i.test(e.name)) return { t: "SUCCESS", cls: "text-emerald-300" };
  return { t: "OK", cls: "text-gray-400" };
}

function metaStr(e: Evt): string {
  const m = e.meta || {};
  const pick = (...k: string[]) => { for (const x of k) { const v = m[x]; if (v != null && v !== "") return String(v); } return ""; };
  const parts: string[] = [];
  const prov = pick("provider", "tts_provider"); const model = pick("model");
  if (prov) parts.push(model ? `${prov}/${model}` : prov); else if (model) parts.push(model);
  const lang = pick("language", "stt_language"); if (lang) parts.push(lang);
  const http = pick("http_status", "status_code"); if (http) parts.push(`HTTP ${http}`);
  const txt = pick("text", "transcript"); if (txt) parts.push(`"${txt.slice(0, 60)}"`);
  const err = pick("error", "reason", "detail", "impact"); if (err) parts.push(err.slice(0, 120));
  return parts.join(" · ");
}

export default function CallLogsView({
  room, hasUser, hasAI, connected,
}: { room: string | null; hasUser: boolean; hasAI: boolean; connected: boolean }) {
  const [rows, setRows] = useState<RawLog[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!room) { setRows([]); return; }
    let off = false;
    setRows(null); setErr("");
    fetch(`/api/voice/events?room=${encodeURIComponent(room)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { events?: RawLog[] }) => { if (!off) setRows(j.events ?? []); })
      .catch((e) => { if (!off) { setErr(String(e)); setRows([]); } });
    return () => { off = true; };
  }, [room]);

  const evts = useMemo(() => parseRawLogs(rows ?? [], room), [rows, room]);
  const d = useMemo(() => derive(evts, Date.now()), [evts]);
  const reached = useMemo(() => reachedFromEvents(evts), [evts]);
  const txEv = useMemo(() => ({ hasUser, hasAI, connected }), [hasUser, hasAI, connected]);

  // First real event timestamp per stage (for the flow table).
  const stageTs = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of evts) {
      for (const [k, names] of Object.entries(STAGE_EVENTS)) {
        if (out[k] == null && names.includes(e.name)) out[k] = e.ts;
      }
    }
    return out;
  }, [evts]);

  // All error events, oldest-first.
  const errEvents = useMemo(
    () => evts.filter((e) => ["ERROR", "CRITICAL"].includes((e.level || "").toUpperCase())),
    [evts],
  );
  // Fallback breakpoint when derive() reports none.
  const fallbackBreak = useMemo(() => {
    if (d.breakStageKey) return null;
    for (const e of errEvents) {
      for (const [re, stage] of ERROR_STAGE) {
        if (re.test(e.name)) return { stageKey: stage, evt: e };
      }
    }
    return null;
  }, [d.breakStageKey, errEvents]);

  const effBreakKey = d.breakStageKey ?? fallbackBreak?.stageKey ?? null;
  const breakIdx = effBreakKey ? FLOW_NODES.findIndex((n) => n.key === effBreakKey) : -1;

  // Errors other than the identified breakpoint (req: show secondary errors).
  const secondary = useMemo(() => {
    const isErr = (e: Evt) => ["ERROR", "CRITICAL"].includes((e.level || "").toUpperCase());
    const all = evts.filter(isErr);
    const seen = new Set<string>();
    return all.filter((e) => {
      if (d.breakTs && Math.abs(e.ts - d.breakTs) < 1200) return false;  // the primary break
      if (fallbackBreak && e.id === fallbackBreak.evt.id) return false;  // shown as the breakpoint
      if (seen.has(e.name)) return false;
      seen.add(e.name); return true;
    }).slice(-6);
  }, [evts, d.breakTs, fallbackBreak]);

  if (rows === null) {
    return <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-gray-400">
      <Loader2 size={13} className="mr-2 inline animate-spin" />Loading this call&apos;s events…
    </div>;
  }
  if (!room) {
    return <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-gray-400">
      This call has no LiveKit room recorded, so per-call pipeline events cannot be looked up.
    </div>;
  }

  const fail = d.fail;

  return (
    <div className="space-y-5">
      {/* ── 3. CALL FLOW ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">Call flow</h2>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className="grid grid-cols-[minmax(0,1.4fr)_110px_96px_80px] gap-2 bg-white/[0.03] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-gray-500">
            <span>Stage</span><span>Status</span><span>Time</span><span className="text-right">Latency</span>
          </div>
          {FLOW_NODES.map((n, i) => {
            const v = stageCardView(d, n.key, reached, txEv);
            const isBreak = effBreakKey === n.key;
            // Apply the effective breakpoint: the break stage is FAILED and any
            // later stage that didn't independently succeed is NOT REACHED.
            const status: StageView["status"] = isBreak
              ? "failed"
              : breakIdx >= 0 && i > breakIdx && v.status !== "success"
                ? "not_reached"
                : v.status;
            const w = WORD[status];
            const lat = flowLatency(d, n.key) ?? v.latency;
            const lab = STAGE_LABELS[n.key];
            return (
              <div key={n.key} className={`grid grid-cols-[minmax(0,1.4fr)_110px_96px_80px] items-center gap-2 border-t border-white/5 px-3 py-1.5 text-xs ${isBreak ? "bg-red-500/[0.07]" : ""}`}>
                <span className="min-w-0 truncate text-gray-200">
                  {lab?.name ?? n.label}
                  <span className="ml-1.5 text-[10px] text-gray-500">{lab?.provider ?? n.tech}</span>
                </span>
                <span className={`font-mono text-[11px] font-semibold ${w.cls}`}>{w.t}</span>
                <span className="font-mono text-[11px] text-gray-500">{clock(stageTs[n.key] ?? (isBreak ? d.breakTs : null))}</span>
                <span className="text-right font-mono text-[11px] text-gray-400">{lat != null ? `${Math.round(lat)} ms` : "—"}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 4. BREAKPOINT / ERROR ────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">Error &amp; breakpoint</h2>
        {effBreakKey || fail ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-xs">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wide text-red-300">
              Breakpoint: {fail?.stageLabel ?? STAGE_LABELS[effBreakKey ?? ""]?.name ?? d.breakLabel ?? effBreakKey}
              {fail?.kind === "stuck" && " (stalled)"}
            </div>
            <dl className="mt-1.5 space-y-0.5">
              <Row k="ERROR" v={
                [fail?.errorType, fail?.httpStatus ? `HTTP ${fail.httpStatus}` : null, fail?.providerCode]
                  .filter(Boolean).join(" · ")
                || (fallbackBreak ? `${fallbackBreak.evt.name}${httpOf(fallbackBreak.evt) ? ` · HTTP ${httpOf(fallbackBreak.evt)}` : ""}` : "")
                || d.breakProvider || "—"} />
              <Row k="ROOT CAUSE" v={fail?.reason || d.breakReason || (fallbackBreak ? (metaStr(fallbackBreak.evt) || fallbackBreak.evt.name) : "—")} />
              <Row k="IMPACT" v={impactOf(effBreakKey, fail?.nextExpected)} />
              {fail?.lastSuccessful && <Row k="LAST OK" v={fail.lastSuccessful} />}
              {fail?.nextExpected && <Row k="NEXT EXPECTED" v={fail.nextExpected} />}
              <Row k="WHEN" v={clock(fail?.ts ?? d.breakTs ?? fallbackBreak?.evt.ts ?? null)} />
            </dl>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3 text-xs text-emerald-300">
            No pipeline breakpoint detected for this call.
          </div>
        )}

        {secondary.length > 0 && (
          <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-gray-500">Secondary errors ({secondary.length})</div>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {secondary.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-2">
                  <span className="text-gray-600">{clock(e.ts)}</span>
                  <span className="text-gray-500">{e.source}</span>
                  <span className="text-red-300">{e.name}</span>
                  <span className="min-w-0 break-all text-gray-500">{metaStr(e).slice(0, 110)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── 6. FULL EVENT TIMELINE ───────────────────────────────────── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-200">
          Full event timeline
          <span className="font-mono text-[10px] font-normal text-gray-500">{evts.length} events · room {room}</span>
        </h2>
        {err && <div className="mb-2 rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300">{err}</div>}
        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className="grid grid-cols-[88px_80px_minmax(0,1fr)_74px_66px_minmax(0,1.3fr)] gap-2 bg-white/[0.03] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-gray-500">
            <span>Time</span><span>Source</span><span>Event</span><span>Status</span><span>Latency</span><span>Details</span>
          </div>
          <div className="max-h-[460px] overflow-y-auto">
            {evts.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-500">No pipeline events recorded for this call.</div>
            )}
            {[...evts].reverse().map((e) => <TimelineRow key={e.id} e={e} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

function httpOf(e: Evt): string {
  const m = e.meta || {};
  for (const k of ["http_status", "status_code"]) { const v = m[k]; if (v != null && v !== "") return String(v); }
  return "";
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-mono text-[10px] uppercase tracking-wide text-gray-500">{k}</dt>
      <dd className="min-w-0 break-words text-gray-200">{v}</dd>
    </div>
  );
}

function TimelineRow({ e }: { e: Evt }) {
  const [open, setOpen] = useState(false);
  const s = evStatus(e);
  const lat = (() => { const m = e.meta || {}; for (const k of ["latency_ms", "total_ms", "elapsed_ms"]) { const v = m[k]; if (v != null) return String(v); } return ""; })();
  const isErr = s.t === "ERROR";
  return (
    <div className={`border-t border-white/5 ${isErr ? "bg-red-500/[0.05]" : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[88px_80px_minmax(0,1fr)_74px_66px_minmax(0,1.3fr)] items-start gap-2 px-3 py-1 text-left font-mono text-[11px] hover:bg-white/5">
        <span className="text-gray-600">{clock(e.ts)}</span>
        <span className="truncate text-gray-500">{e.source}</span>
        <span className={`min-w-0 break-words ${isErr ? "text-red-300" : "text-gray-200"}`}>
          {e.name}<ChevronRight size={10} className={`ml-1 inline text-gray-600 ${open ? "rotate-90" : ""}`} />
        </span>
        <span className={`font-semibold ${s.cls}`}>{s.t}</span>
        <span className="text-gray-400">{lat ? `${lat} ms` : "—"}</span>
        <span className="min-w-0 break-words text-gray-500">{metaStr(e)}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-white/5 bg-black/50 px-3 py-1.5 text-[10px] text-gray-400">
          {JSON.stringify(e.meta ?? {}, null, 2)}
        </pre>
      )}
    </div>
  );
}

// Plain-language consequence of a break at `stageKey` — derived from the stage's
// position in the pipeline, not fabricated per-call narrative.
function impactOf(stageKey: string | null, nextExpected?: string | null): string {
  if (!stageKey) return "—";
  switch (stageKey) {
    case "request": case "api": case "dispatch":
      return "The call was never dispatched, so no worker or room was created.";
    case "worker":
      return "No agent worker picked up the job — the caller would hear nothing.";
    case "vobiz":
      return "Telephony never connected the caller, so the call did not progress.";
    case "livekit_in":
      return "Caller media never reached the agent — no audio could be processed.";
    case "deepgram":
      return "Caller audio reached LiveKit, but transcription failed, so the agent could not continue the conversation.";
    case "groq":
      return "Speech was transcribed but no reply was generated, so nothing was spoken back.";
    case "sarvam":
      return "A reply was generated but could not be synthesised to speech.";
    case "livekit_out": case "customer_out":
      return "Audio was generated but never reached the caller.";
    default:
      return nextExpected ? `Did not reach: ${nextExpected}.` : "—";
  }
}
