"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ParticipantKind,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import {
  installLiveKitLogRouting, attachRoomLifecycleLogging, logRoomConnect,
  disconnectOnce, logMount,
} from "@/lib/livekitLifecycle";
import { Phone, PhoneOff, Delete, X, Loader2, Mic, Volume2, Bot } from "lucide-react";
import { quickDispatchAction } from "@/app/(admin)/_actions/quick-dispatch";
import { emitLiveEvent } from "@/lib/liveBus";
import ContactSearch from "./ContactSearch";
import Select from "./Select";

// Active assistants offered in the dialer's Assistant dropdown. Loaded from the
// DB by the Calls page (server component) and passed in — never hardcoded.
export type DialerAssistant = {
  id: string;
  name: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  voiceId: string | null;
};

// Publish a structured diagnostic event to /api/voice/diag. This mirrors the
// SAME failure the dialer shows into the error_logs store the Voice Pipeline
// Diagnostics consumes — so "Fetch failed" on this page becomes "FAILED AT
// Voice API · HTTP 504" there, automatically and in agreement. Fire-and-forget:
// a diagnostics write must never block or break the call UX.
function postDiag(body: Record<string, unknown>): void {
  try {
    void fetch("/api/voice/diag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ts: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

// Classify a dispatch failure (from quickDispatchAction's error string) into the
// structured fields the diagnostics needs: which stage broke, the HTTP status,
// a machine error_type, and a human reason. The error string is shaped either
// "voice-service /api/dispatch/single -> 504 <body>" (API returned non-2xx) or a
// raw fetch/network message ("fetch failed", "ECONNREFUSED", a timeout).
function classifyDispatchError(err: string): {
  stage: string; http_status: number | null; error_type: string; reason: string; last_successful: string; next_expected: string;
} {
  const m = /->\s*(\d{3})/.exec(err);
  const http = m ? Number(m[1]) : null;
  const lower = err.toLowerCase();
  if (http != null) {
    const et = http === 504 ? "HTTP_504" : http === 502 ? "HTTP_502" : http === 503 ? "HTTP_503" : http >= 500 ? "HTTP_5xx" : "HTTP_4xx";
    const gloss = http === 504 ? "gateway timeout" : http === 502 ? "bad gateway" : http === 503 ? "service unavailable" : http >= 500 ? "server error" : "request rejected";
    return {
      stage: "api", http_status: http, error_type: et,
      reason: `HTTP ${http} — Fetch failed (voice API ${gloss})`,
      last_successful: "Call request sent", next_expected: "LiveKit dispatch created",
    };
  }
  if (lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("network") || lower.includes("failed to fetch")) {
    return {
      stage: "api", http_status: null, error_type: "fetch_failed",
      reason: "Fetch failed — could not reach the Voice API",
      last_successful: "Call request sent", next_expected: "Voice API accepts request",
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return {
      stage: "api", http_status: null, error_type: "timeout",
      reason: "Request to Voice API timed out",
      last_successful: "Call request sent", next_expected: "LiveKit dispatch created",
    };
  }
  return {
    stage: "dispatch", http_status: null, error_type: "dispatch_failed",
    reason: err || "Dispatch failed",
    last_successful: "Voice API accepted", next_expected: "Worker receives job",
  };
}

// Phone-style dialer for the Calls page. Reuses the EXISTING outbound flow
// (quickDispatchAction → /api/dispatch/single → voice-agent dials via
// OUTBOUND_TRUNK_ID). To render live call state + the audio monitor it joins the
// SAME LiveKit room as a passive listener (read-only monitor token), because an
// outbound call's audio lives on the LiveKit/SIP side, not in the browser.

type CallState =
  | "idle" | "calling" | "ringing" | "in_call" | "ending"
  | "completed" | "failed" | "no_answer" | "busy" | "cancelled";

const STATE_LABEL: Record<CallState, string> = {
  idle: "Idle", calling: "Calling…", ringing: "Ringing…", in_call: "In call",
  ending: "Ending…", completed: "Call ended", failed: "Failed",
  no_answer: "No answer", busy: "Busy", cancelled: "Cancelled",
};
const STATE_TONE: Record<CallState, string> = {
  idle: "text-gray-400 border-white/15 bg-white/5",
  calling: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  ringing: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  in_call: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  ending: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  completed: "text-gray-300 border-white/15 bg-white/5",
  failed: "text-red-300 border-red-500/40 bg-red-500/10",
  no_answer: "text-red-300 border-red-500/40 bg-red-500/10",
  busy: "text-red-300 border-red-500/40 bg-red-500/10",
  cancelled: "text-gray-300 border-white/15 bg-white/5",
};
const ACTIVE_STATES: CallState[] = ["calling", "ringing", "in_call", "ending"];
// Phone keypad. "+" lives on the dialer (prepended, E.164-style); "*" omitted.
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "#"];

function normalizeE164(raw: string): string {
  const t = raw.trim();
  return t.startsWith("+") ? t : `+${t}`;
}
function isValidE164(raw: string): boolean {
  return /^\+\d{8,15}$/.test(normalizeE164(raw));
}
function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type MeterStats = {
  db: number; dominant: number; peak: number; sampleRate: number;
  bars: number[]; status: "no_signal" | "silent" | "active" | "voice";
  hasTrack: boolean;
};
const EMPTY_STATS: MeterStats = {
  db: -100, dominant: 0, peak: 0, sampleRate: 0,
  bars: new Array(24).fill(0), status: "no_signal", hasTrack: false,
};

export default function PhoneDialer({
  assistants = [],
}: {
  assistants?: DialerAssistant[];
}) {
  const [number, setNumber] = useState("");
  // Selected assistant for this call. Defaults to the first active assistant
  // (no dedicated default-assistant flag exists on the Assistant model).
  const [assistantId, setAssistantId] = useState(assistants[0]?.id ?? "");
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState("");
  const [room, setRoomName] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [agentStats, setAgentStats] = useState<MeterStats>(EMPTY_STATS);
  const [callerStats, setCallerStats] = useState<MeterStats>(EMPTY_STATS);

  // Correlation ID for ONE call attempt, from button click → end. Carried on
  // every diagnostic event so the Voice Pipeline Diagnostics can track a single
  // attempt even BEFORE a LiveKit room exists (e.g. an API 504 / fetch failure).
  const attemptRef = useRef<string>("");
  const lkRoomRef = useRef<Room | null>(null);
  const lkDetachRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answeredAtRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<{ agent?: AnalyserNode; caller?: AnalyserNode }>({});
  // Hidden <audio> sinks for the subscribed remote tracks. A remote WebRTC track
  // fed into Web Audio produces SILENCE unless it is also attached to a playing
  // media element, so these are required for the meters to move (and they let
  // the operator monitor the live call by ear).
  const audioElsRef = useRef<HTMLMediaElement[]>([]);
  const rafRef = useRef<number>(0);

  const active = ACTIVE_STATES.includes(state);

  // Assistant dropdown options + the currently selected assistant (for the
  // Call-status label). Secondary label mirrors the Assistants page: provider ·
  // model · tts/voice.
  const hasAssistants = assistants.length > 0;
  const assistantOptions = assistants.map((a) => ({
    value: a.id,
    label: a.name,
    description: `${a.llmProvider} · ${a.llmModel} · ${a.ttsProvider}${a.voiceId ? `/${a.voiceId}` : ""}`,
  }));
  const selectedAssistant = assistants.find((a) => a.id === assistantId) ?? null;

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const startTimer = () => {
    if (timerRef.current) return;
    answeredAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      if (answeredAtRef.current) setElapsed(Math.floor((Date.now() - answeredAtRef.current) / 1000));
    }, 1000);
  };

  const teardown = useCallback(() => {
    stopTimer();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    analysersRef.current = {};
    // Stop + remove the hidden monitor audio elements.
    for (const el of audioElsRef.current) {
      try { el.pause(); (el as HTMLMediaElement).srcObject = null; el.remove(); } catch { /* ignore */ }
    }
    audioElsRef.current = [];
    try { void ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
    const r = lkRoomRef.current;
    lkRoomRef.current = null;
    // disconnectOnce marks a teardown window and is idempotent, so a second
    // teardown (StrictMode remount, or end-call followed by unmount) cannot
    // race the first one's cleanup. Listeners are dropped only afterwards, so
    // RoomEvent.Disconnected and its reason are still reported.
    const detach = lkDetachRef.current;
    lkDetachRef.current = null;
    if (r) {
      void disconnectOnce(r, "dialer", "teardown").finally(() => detach?.());
    } else {
      detach?.();
    }
  }, []);

  useEffect(() => {
    installLiveKitLogRouting();
    const unmount = logMount("dialer");
    return () => { unmount(); teardown(); };
  }, [teardown]);

  // ── audio analysis loop (reads whatever analysers are currently attached) ──
  const ensureLoop = useCallback(() => {
    if (rafRef.current) return;
    const time = new Float32Array(1024);
    const freq = new Float32Array(1024);
    const compute = (an: AnalyserNode | undefined, sr: number): MeterStats => {
      if (!an) return EMPTY_STATS;
      an.getFloatTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < an.fftSize; i++) sum += time[i] * time[i];
      const rms = Math.sqrt(sum / an.fftSize);
      const db = rms > 1e-7 ? 20 * Math.log10(rms) : -100;
      an.getFloatFrequencyData(freq);
      const bins = an.frequencyBinCount;
      const hzPerBin = sr / an.fftSize;
      let maxV = -Infinity, maxI = 0;
      const bars = new Array(24).fill(0);
      for (let i = 0; i < bins; i++) {
        if (freq[i] > maxV) { maxV = freq[i]; maxI = i; }
        const b = Math.floor((i / bins) * 24);
        const norm = Math.max(0, Math.min(1, (freq[i] + 100) / 70));
        if (norm > bars[b]) bars[b] = norm;
      }
      const dominant = Math.round(maxI * hzPerBin);
      const status: MeterStats["status"] =
        db < -80 ? "no_signal" : db < -55 ? "silent" : db < -38 ? "active" : "voice";
      return { db, dominant, peak: dominant, sampleRate: sr, bars, status, hasTrack: true };
    };
    const peaks = { agent: 0, caller: 0 };
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      // Self-heal: Chrome can suspend the context (autoplay policy / tab blur).
      if (ctxRef.current && ctxRef.current.state === "suspended") void ctxRef.current.resume().catch(() => {});
      const sr = ctxRef.current?.sampleRate || 48000;
      const a = compute(analysersRef.current.agent, sr);
      const c = compute(analysersRef.current.caller, sr);
      peaks.agent = Math.max(peaks.agent * 0.995, a.dominant);
      peaks.caller = Math.max(peaks.caller * 0.995, c.dominant);
      setAgentStats({ ...a, peak: Math.round(peaks.agent) });
      setCallerStats({ ...c, peak: Math.round(peaks.caller) });
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const attachTrack = useCallback((track: RemoteTrack, p: RemoteParticipant) => {
    if (track.kind !== Track.Kind.Audio || !track.mediaStreamTrack) return;
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new AC();
      void ctxRef.current.resume().catch(() => {});
    }
    const ctx = ctxRef.current;
    void ctx.resume().catch(() => {}); // in case it got suspended
    const src = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    // CRITICAL: a remote WebRTC track delivers SILENCE to the Web Audio graph
    // unless it is also attached to a media element that is "playing". We use a
    // MUTED element — muted playback is always allowed (no autoplay block, unlike
    // audible playback whose play() can be rejected outside a user gesture) and
    // still pumps the track into the graph. This is diagnostics-only; the real
    // call audio goes to the phone, and the monitor never publishes a mic.
    try {
      const el = track.attach();
      el.autoplay = true;
      (el as HTMLAudioElement).muted = true;
      el.setAttribute("playsinline", "");
      el.style.display = "none";
      document.body.appendChild(el);
      audioElsRef.current.push(el);
      void (el as HTMLAudioElement).play?.().catch(() => {});
    } catch { /* attach unsupported → meter-only */ }
    const isSip = p.kind === ParticipantKind.SIP || /sip/i.test(p.identity);
    const isAgent = !isSip && (p.kind === ParticipantKind.AGENT || /agent/i.test(p.identity));
    if (isSip) analysersRef.current.caller = an;
    else analysersRef.current.agent = an;
    // Diagnostics (A4/A5) — browser console proves which track feeds which meter.
    try {
      console.info("[voice-monitor]", {
        audio_context_state: ctx.state,
        [`${isSip ? "caller" : "agent"}_analyser_attached`]: true,
        [`${isSip ? "caller" : "agent"}_track_identity`]: p.identity,
        participant_kind: p.kind, track_sid: track.sid, is_sip: isSip, is_agent: isAgent,
      });
    } catch { /* ignore */ }
    ensureLoop();
  }, [ensureLoop]);

  // Map a SIP participant's call status → UI state.
  const applySipStatus = useCallback((p: RemoteParticipant) => {
    const isSip = p.kind === ParticipantKind.SIP || /sip/i.test(p.identity);
    if (!isSip) return;
    const cs = (p.attributes?.["sip.callStatus"] || "").toLowerCase();
    if (cs === "active") {
      setState((s) => (ACTIVE_STATES.includes(s) ? "in_call" : s));
      startTimer();
    } else if (cs === "ringing") {
      setState((s) => (s === "calling" ? "ringing" : s));
    }
  }, []);

  async function startCall() {
    setError("");
    // Ephemeral UI-action event — shows the click in Live Logs INSTANTLY, before
    // any network round-trip (not persisted to the DB).
    emitLiveEvent({ category: "UI", event: "manual_call_clicked", detail: { number } });
    const phone = normalizeE164(number);
    if (!isValidE164(phone)) {
      setError("Enter a valid number in E.164 format, e.g. +919876543210.");
      emitLiveEvent({ category: "UI", event: "manual_call_rejected_invalid_number", level: "WARNING", detail: { number } });
      return;
    }
    teardown();
    setElapsed(0);
    answeredAtRef.current = null;
    setAgentStats(EMPTY_STATS);
    setCallerStats(EMPTY_STATS);
    setState("calling");
    // Start a fresh correlation ID for this attempt and publish the FIRST
    // lifecycle event (Call Request sent) so the diagnostics shows this attempt
    // from the instant the user clicks — never "Idle".
    const attemptId = (globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    attemptRef.current = attemptId;
    const assistantName = assistants.find((a) => a.id === assistantId)?.name ?? null;
    const startedAt = Date.now();
    postDiag({ name: "call_attempt_started", level: "INFO", stage: "request", status: "started", call_attempt_id: attemptId, phone, assistant: assistantName, reason: "Call request sent" });
    emitLiveEvent({ category: "CALL", event: "call_requested", detail: { call_attempt_id: attemptId, phone, assistant: assistantName } });
    // Create + resume the AudioContext NOW, inside the click gesture. If it's
    // created later (on TrackSubscribed) it starts SUSPENDED and the analysers
    // read silence → the meters stay frozen even while real audio flows. This
    // (not the track wiring) was why the meters never moved.
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new AC();
      void ctxRef.current.resume().catch(() => {});
    } catch { /* ignore */ }
    try {
      // 1. Initiate via the EXISTING outbound flow, tagging the chosen assistant
      //    so the worker loads that assistant's profile for this call.
      const fd = new FormData();
      fd.set("phone", phone);
      if (assistantId) fd.set("assistant_id", assistantId);
      const r = await quickDispatchAction(null, fd);
      if (!r.ok) {
        setState("failed"); setError(r.error);
        // Publish the SAME failure the Calls page shows into the diagnostics
        // store, structured so the pipeline view reads "FAILED AT <stage>".
        const c = classifyDispatchError(r.error);
        postDiag({
          name: "call_failed", level: "ERROR", status: "failed",
          call_attempt_id: attemptId, phone, assistant: assistantName,
          stage: c.stage, http_status: c.http_status, error_type: c.error_type,
          reason: c.reason, last_successful: c.last_successful, next_expected: c.next_expected,
          elapsed_ms: Date.now() - startedAt,
        });
        return;
      }
      setRoomName(r.room);
      // Dispatch accepted → request + Voice API + dispatch all succeeded. Carry
      // BOTH the attempt ID and the real room so the diagnostics can unify this
      // attempt's pre-room events with the worker's room-keyed events.
      postDiag({ name: "dispatch_ok", level: "INFO", stage: "dispatch", status: "ok", call_attempt_id: attemptId, room: r.room, phone, assistant: assistantName, reason: "Dispatch created", last_successful: "Voice API accepted", next_expected: "Worker receives job" });

      // 2. Join the SAME room as a read-only monitor for live state + audio.
      const tr = await fetch("/api/calls/token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: r.room }),
      });
      if (!tr.ok) {
        // Call is placed; we just can't monitor. Keep "calling" rather than fail.
        return;
      }
      const { token, url } = await tr.json();
      const lkRoom = new Room();
      lkRoomRef.current = lkRoom;
      lkDetachRef.current = attachRoomLifecycleLogging(lkRoom, "dialer");

      lkRoom.on(RoomEvent.TrackSubscribed, (track, _pub, p) => attachTrack(track, p as RemoteParticipant));
      lkRoom.on(RoomEvent.ParticipantConnected, (p) => applySipStatus(p as RemoteParticipant));
      lkRoom.on(RoomEvent.ParticipantAttributesChanged, (_c, p) => applySipStatus(p as RemoteParticipant));
      lkRoom.on(RoomEvent.ParticipantDisconnected, (p) => {
        const isSip = (p as RemoteParticipant).kind === ParticipantKind.SIP || /sip/i.test(p.identity);
        if (isSip) { stopTimer(); setState((s) => (s === "in_call" || s === "ending" ? "completed" : s === "ringing" || s === "calling" ? "no_answer" : s)); }
      });
      lkRoom.on(RoomEvent.Disconnected, () => {
        stopTimer();
        setState((s) => (ACTIVE_STATES.includes(s) ? (answeredAtRef.current ? "completed" : "cancelled") : s));
      });

      logRoomConnect("dialer", r.room);
      await lkRoom.connect(url, token);
      // Pick up participants already present at join time.
      lkRoom.remoteParticipants.forEach((p) => {
        applySipStatus(p);
        p.trackPublications.forEach((pub) => {
          if (pub.track) attachTrack(pub.track as RemoteTrack, p);
        });
      });
    } catch (exc) {
      setState("failed");
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function endCall() {
    setState("ending");
    emitLiveEvent({ category: "CALL", event: "call_ended", detail: { call_attempt_id: attemptRef.current, room } });
    try {
      if (room) {
        await fetch("/api/calls/end", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room }),
        });
      }
    } catch { /* ignore */ }
    teardown();
    setState((s) => (answeredAtRef.current ? "completed" : "cancelled"));
  }

  const onKey = (k: string) => {
    if (active) return;
    if (k === "+") { setNumber((n) => (n.includes("+") ? n : "+" + n)); return; }
    setNumber((n) => n + k);
  };
  const onBackspace = () => { if (!active) setNumber((n) => n.slice(0, -1)); };
  const onClear = () => { if (!active) { setNumber(""); setError(""); setState("idle"); } };

  const showValidation = number.length > 0 && !isValidE164(number) && !active;

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-purple-500/10 to-blue-500/10 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Phone size={16} className="text-purple-300" />
        <h2 className="text-sm font-semibold">Call a number</h2>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATE_TONE[state]}`}>
          {(state === "calling" || state === "ending") && <Loader2 size={11} className="animate-spin" />}
          {state === "ringing" && <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />}
          {state === "in_call" && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
          {STATE_LABEL[state]}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* LEFT: input + keypad + controls */}
        <div>
          {!active && (
            <ContactSearch
              onSelect={(phone) => { setNumber(phone); setError(""); }}
            />
          )}
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !active) startCall(); }}
            placeholder="+91XXXXXXXXXX"
            inputMode="tel"
            disabled={active}
            style={{ color: "#ffffff", WebkitTextFillColor: "#ffffff", caretColor: "#ffffff", opacity: 1 }}
            className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-3 text-center font-mono text-2xl font-semibold tracking-widest placeholder:text-base placeholder:font-normal placeholder:tracking-wider placeholder:text-white/[0.65] focus:border-emerald-400/50 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
          />
          {showValidation && (
            <p className="mt-1 text-[11px] text-red-300">Invalid number — use E.164, e.g. +919876543210.</p>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => onKey(k)}
                disabled={active}
                className="rounded-xl bg-slate-700/80 py-3.5 text-xl font-semibold text-white shadow-md shadow-black/20 ring-1 ring-white/10 transition hover:bg-slate-600 hover:ring-white/20 active:scale-95 active:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-700/30 disabled:text-white/40 disabled:shadow-none"
              >
                {k}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            {!active ? (
              <>
                <button
                  type="button"
                  onClick={startCall}
                  disabled={!isValidE164(number) || !assistantId}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-[0.98] disabled:bg-emerald-500/25 disabled:text-white/60 disabled:shadow-none"
                >
                  <Phone size={18} /> Call
                </button>
                <button type="button" onClick={onBackspace} disabled={!number}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-gray-200 transition hover:bg-white/15 active:scale-95 disabled:opacity-30" title="Backspace">
                  <Delete size={18} />
                </button>
                <button type="button" onClick={onClear} disabled={!number && state === "idle"}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-gray-200 transition hover:bg-white/15 hover:text-red-300 active:scale-95 disabled:opacity-30" title="Clear">
                  <X size={18} />
                </button>
              </>
            ) : (
              <div className="flex w-full items-center justify-center gap-3 py-1">
                <button
                  type="button"
                  onClick={endCall}
                  title="End call"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-600 active:scale-95"
                >
                  <PhoneOff size={22} />
                </button>
                <span className="text-xs font-medium text-gray-400">End call</span>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-2 break-words rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* CENTER: assistant selector + live call status + timer. This is the
            ONLY assistant dropdown on the page; it drives the outbound call. */}
        <div className="flex flex-col rounded-xl border border-white/10 bg-black/30 p-4">
          {/* Assistant — above the status pill. */}
          <span className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-400">
            <Bot size={12} className="text-purple-300" /> Assistant
          </span>
          {hasAssistants ? (
            <Select
              name="assistant_id"
              options={assistantOptions}
              defaultValue={assistantId}
              disabled={active}
              onChange={setAssistantId}
            />
          ) : (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              Create an assistant before making a call.
            </p>
          )}

          {/* Status */}
          <div className="mt-3 text-[10px] uppercase tracking-wide text-gray-500">Status</div>
          <div className={`mt-1 inline-flex self-start items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${STATE_TONE[state]}`}>
            {(state === "calling" || state === "ending") && <Loader2 size={13} className="animate-spin" />}
            {state === "ringing" && <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />}
            {state === "in_call" && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
            {STATE_LABEL[state]}
          </div>

          {/* Number + assistant details (name, voice). */}
          <div className="mt-3">
            <div className="truncate font-mono text-lg text-white">{number || "—"}</div>
            <div className="truncate text-sm text-gray-200">{selectedAssistant?.name ?? "—"}</div>
            {selectedAssistant && (
              <div className="truncate text-[11px] text-gray-500">
                {selectedAssistant.ttsProvider}
                {selectedAssistant.voiceId ? ` / ${selectedAssistant.voiceId}` : ""}
              </div>
            )}
          </div>

          <div className="mt-auto pt-6 text-center">
            <div className={`font-mono text-4xl tabular-nums ${state === "in_call" ? "text-emerald-300" : "text-gray-500"}`}>
              {fmtDuration(elapsed)}
            </div>
            <div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-gray-500">
              {state === "in_call" && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
              {state === "in_call" ? "connected" : state === "ringing" ? "ringing…" : state === "calling" ? "connecting…" : STATE_LABEL[state]}
            </div>
            {room && <div className="mt-2 text-[10px] font-mono text-gray-600">room {room}</div>}
          </div>
        </div>

        {/* RIGHT: audio / frequency monitors */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <Meter title="Caller input" source="SIP participant / customer track" icon={<Mic size={13} className="text-purple-300" />} stats={callerStats} tone="purple" kind="caller" active={active} />
          <Meter title="Agent output" source="LiveKit agent audio track" icon={<Volume2 size={13} className="text-blue-300" />} stats={agentStats} tone="blue" kind="agent" active={active} />
          <p className="mt-3 text-[10px] text-gray-600">Listen-only: the browser joins the room and subscribes to the real SIP + agent tracks (never your mic). You can also hear the live call here.</p>
        </div>
      </div>
    </div>
  );
}

function Meter({ title, source, icon, stats, tone, kind, active }: { title: string; source: string; icon: React.ReactNode; stats: MeterStats; tone: "blue" | "purple"; kind: "caller" | "agent"; active: boolean }) {
  const speaking = active && stats.hasTrack && (stats.status === "voice" || stats.status === "active");
  const barColor =
    stats.status === "voice" ? (tone === "blue" ? "bg-blue-400" : "bg-emerald-400")
    : stats.status === "active" ? (tone === "blue" ? "bg-blue-400/70" : "bg-purple-400/70")
    : "bg-white/15";
  let statusLabel: string;
  let statusTone: string;
  if (!active) { statusLabel = "No signal"; statusTone = "text-gray-500"; }
  else if (!stats.hasTrack) { statusLabel = kind === "caller" ? "No input track" : "No output track"; statusTone = "text-amber-300"; }
  else if (speaking) { statusLabel = kind === "caller" ? "Receiving caller audio" : "Agent speaking"; statusTone = kind === "caller" ? "text-emerald-300" : "text-blue-300"; }
  else { statusLabel = "Silent"; statusTone = "text-gray-400"; }
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300">
        {icon} {title}
        <span className={`ml-auto ${statusTone}`}>{statusLabel}</span>
      </div>
      <div className="text-[9px] text-gray-600">Source: {source}</div>
      <div className="mt-1 flex h-8 items-end gap-[2px]">
        {stats.bars.map((v, i) => (
          <div key={i} className={`flex-1 rounded-sm ${barColor}`} style={{ height: `${Math.max(4, v * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1 text-[9px] font-mono text-gray-500">
        <span>{stats.db <= -99 ? "— dB" : `${stats.db.toFixed(0)} dB`}</span>
        <span>{stats.dominant || "—"} Hz</span>
        <span>pk {stats.peak || "—"}</span>
        <span>{stats.sampleRate ? `${(stats.sampleRate / 1000).toFixed(0)}k` : "—"}</span>
      </div>
    </div>
  );
}
