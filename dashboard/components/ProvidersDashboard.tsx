"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProviderBadges from "./ProviderBadges";
import { Wifi, WifiOff, RotateCw, Loader2 } from "lucide-react";
import { useLiveEvents } from "@/lib/liveEvents";
import { mf, type LiveEvent } from "@/lib/eventModel";
import {
  PROVIDERS, deriveProviderMetrics, matchProvider,
  type ProviderDef, type ProviderMetrics, type ProviderStatus,
} from "@/lib/providerRegistry";
import ProviderActivityPanel from "./ProviderActivityPanel";
import { deriveCardStatus, CARD_STYLE, type CardStatus } from "@/lib/providerStatus";

const TIME_FMT = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
const fmt = (ms: number | null) => (ms == null ? "—" : TIME_FMT.format(ms));

const DOT: Record<ProviderStatus, string> = {
  healthy: "bg-emerald-400", warning: "bg-yellow-400", failed: "bg-red-500",
  disconnected: "bg-red-500", none: "bg-gray-600", disabled: "bg-gray-700",
};
const STATUS_LABEL: Record<ProviderStatus, string> = {
  healthy: "HEALTHY", warning: "WARNING", failed: "FAILED",
  disconnected: "DISCONNECTED", none: "NO ACTIVITY", disabled: "DISABLED",
};

// Global latest-call pipeline (req 25): stage → the providers that serve it.
const PIPELINE: { stage: string; providers: string[] }[] = [
  { stage: "SIP", providers: ["vobiz"] },
  { stage: "LIVEKIT", providers: ["livekit"] },
  { stage: "STT", providers: ["deepgram", "sarvam"] },
  { stage: "LLM", providers: ["groq", "google", "openai", "anthropic"] },
  { stage: "TOOLS", providers: ["calcom"] },
  { stage: "TTS", providers: ["sarvam", "gemini_tts", "elevenlabs", "cartesia"] },
  { stage: "AUDIO", providers: ["livekit", "recording"] },
];

export default function ProvidersDashboard({ configured }: { configured: Record<string, boolean> }) {
  const { events, conn, connErr, startedAt, lastEventAt, nowMs } = useLiveEvents();
  const [selected, setSelected] = useState<string | null>(null);
  const disconnected = conn === "error" || conn === "closed";

  // REAL per-provider status from PERSISTED runtime events (health probes +
  // genuine call traffic). Never derived from "a key exists".
  const [serverCards, setServerCards] = useState<Record<string, CardStatus>>({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await fetch("/api/providers/status", { cache: "no-store" });
      const j = await r.json();
      const map: Record<string, CardStatus> = {};
      for (const p of (j.providers ?? [])) map[p.key] = p as CardStatus;
      setServerCards(map);
      setCheckedAt(Date.now());
    } catch { /* leave previous status visible */ }
    finally { setStatusLoading(false); }
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  // Explicit "check all": runs the REAL safe probe for every provider, then
  // re-reads status. Never automatic — one click, one round of probes.
  const checkAll = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      await Promise.all(PROVIDERS.map((d) =>
        fetch(`/api/providers/${encodeURIComponent(d.key)}/diagnose`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "safe" }),
        }).catch(() => null)));
      await loadStatus();
    } finally { setChecking(false); }
  }, [checking, loadStatus]);

  // Live events can be NEWER than the persisted snapshot (e.g. mid-call), so a
  // card turns green/red the moment real call traffic proves it.
  const cards = useMemo(() => {
    const out: Record<string, CardStatus> = {};
    for (const def of PROVIDERS) {
      const server = serverCards[def.key];
      const live = deriveCardStatus(def, events, !!configured[def.key]);
      out[def.key] = (!server || (live.lastCheckedTs ?? 0) > (server.lastCheckedTs ?? 0))
        ? live : server;
    }
    return out;
  }, [serverCards, events, configured]);

  // Card + overview metrics reflect REAL runtime traffic only — diagnostic test
  // hits are excluded here and live in the panel's separate Test tab (req 4).
  const metricsByKey = useMemo(() => {
    const real = events.filter((e) => mf(e.meta, "traffic_type") !== "diagnostic");
    const out: Record<string, ProviderMetrics> = {};
    for (const def of PROVIDERS) out[def.key] = deriveProviderMetrics(def, real, !!configured[def.key]);
    return out;
  }, [events, configured]);

  // Latest call_id in the session → drive the global pipeline.
  const latestCall = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const c = mf(events[i].meta, "call_id", "room");
      if (c) return c;
    }
    return "";
  }, [events]);

  const callEvents = useMemo(
    () => (latestCall ? events.filter((e) => mf(e.meta, "call_id", "room") === latestCall) : []),
    [events, latestCall],
  );

  const pipeline = useMemo(() => {
    const defs = (keys: string[]) => PROVIDERS.filter((p) => keys.includes(p.key));
    let broke = false;
    return PIPELINE.map(({ stage, providers }) => {
      const ds = defs(providers);
      const evs = callEvents.filter((e) => ds.some((d) => matchProvider(d, e)));
      const hasErr = evs.some((e) => e.status === "ERROR" || e.status === "CRITICAL");
      const hasOk = evs.some((e) => e.status === "SUCCESS");
      let state: "ok" | "fail" | "none" = "none";
      if (hasErr) { state = "fail"; }
      else if (hasOk) { state = "ok"; }
      else if (broke) { state = "none"; }
      const glyph = state === "ok" ? "✅" : state === "fail" ? "❌" : broke ? "⏸" : "○";
      if (state === "fail") broke = true;
      return { stage, providers, state, glyph, broke };
    });
  }, [callEvents]);

  const selectedDef = PROVIDERS.find((p) => p.key === selected) || null;
  const ageLabel = lastEventAt == null || nowMs == null ? "—" : `${Math.max(0, Math.round((nowMs - lastEventAt) / 1000))}s ago`;

  // Bring the panel into view ONLY when the selection changes (not on every SSE
  // event). Deferred to the next frame so the newly-mounted panel is laid out
  // before we scroll — otherwise scrollIntoView aims at the pre-mount position.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const id = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [selected]);

  return (
    <div className="space-y-4">
      {/* CONNECTION / SESSION BAR */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-mono uppercase ${conn === "open" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : conn === "connecting" || conn === "reconnecting" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-red-500/40 bg-red-500/10 text-red-300"}`} title={connErr}>
          {disconnected ? <WifiOff size={10} /> : <Wifi size={10} />}
          {conn === "open" ? "CONNECTED" : conn === "reconnecting" ? "RECONNECTING" : conn === "connecting" ? "CONNECTING" : "DISCONNECTED"}
        </span>
        <span className="text-gray-500">Session <span className="font-mono text-gray-300">{startedAt == null ? "starting…" : TIME_FMT.format(startedAt)}</span></span>
        <span className="text-gray-500">Events <span className="font-mono text-gray-300 tabular-nums">{events.length}</span></span>
        <span className="text-gray-500">Last event <span className="font-mono text-gray-300">{ageLabel}</span></span>
        {latestCall && <span className="truncate text-gray-500">Latest call <span className="font-mono text-gray-300">{latestCall}</span></span>}
        <button
          type="button"
          onClick={checkAll}
          disabled={checking}
          title="Run one real, safe health probe against every provider and refresh these cards"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-[11px] text-purple-200 hover:bg-purple-500/20 disabled:opacity-40"
        >
          {checking ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
          {checking ? "Checking all providers…" : "Check all"}
        </button>
        {statusLoading && !checking && <Loader2 size={11} className="animate-spin text-gray-500" />}
        {checkedAt && !checking && (
          <span className="text-[10px] text-gray-500">status {TIME_FMT.format(checkedAt)}</span>
        )}
      </div>

      {disconnected && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          <span className="font-semibold">LIVE DATA DISCONNECTED</span> — provider panels below may be stale.
          {connErr && <> {connErr}</>} Last event {ageLabel}.
        </div>
      )}

      {/* GLOBAL LATEST-CALL PIPELINE */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500">
          Latest call pipeline {latestCall ? <span className="font-mono text-gray-400 normal-case">· {latestCall}</span> : <span className="normal-case text-gray-600">· no active call this session</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {pipeline.map(({ stage, providers, glyph, state }) => (
            <button key={stage} type="button" onClick={() => setSelected(providers.find((k) => configured[k]) || providers[0])}
              className={`rounded border px-2 py-1 ${state === "fail" ? "border-red-500/40 text-red-300" : state === "ok" ? "border-emerald-500/30 text-emerald-300" : "border-white/10 text-gray-500"} hover:bg-white/5`}>
              {stage}&nbsp;{glyph}
            </button>
          ))}
        </div>
      </div>

      {/* PROVIDER CARDS GRID */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((def) => {
          const m = metricsByKey[def.key];
          const c = cards[def.key];
          const isSel = selected === def.key;
          return (
            <button key={def.key} type="button" onClick={() => setSelected(isSel ? null : def.key)}
              className={`rounded-xl border p-3 text-left text-xs transition ${isSel ? "border-purple-500/50 bg-purple-500/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.state === "CONNECTED" && disconnected ? "bg-red-500" : CARD_STYLE[c.state].dot}`} />
                <span className="truncate font-semibold text-fg">{def.label}</span>
                <span className="ml-auto text-[9px] font-mono uppercase tracking-wide text-gray-500">{def.kind}</span>
              </div>
              {/* Plain-English verdicts from real provider testing; the measured
                  detail sits in each badge's tooltip, not next to the name. */}
              <ProviderBadges
                provider={def.key}
                model={c.model}
                category={def.kind === "STT" ? "stt" : def.kind === "TTS" ? "tts" : undefined}
                className="mt-1.5"
              />
              {/* REAL status — CONNECTED only ever comes from a successful
                  diagnostic or genuine call traffic, never from config presence. */}
              <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wide ${CARD_STYLE[c.state].text}`}>
                <span aria-hidden>{CARD_STYLE[c.state].icon}</span>
                <span className="font-semibold">{CARD_STYLE[c.state].label}</span>
                {c.via && <span className="text-[9px] normal-case text-gray-500">via {c.via}</span>}
              </div>
              {(c.model || c.httpStatus != null) && (
                <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] font-mono text-gray-400">
                  {c.model && <span className="truncate" title={c.model}>{c.model}</span>}
                  {c.httpStatus != null && <span>HTTP {c.httpStatus}</span>}
                  {c.latencyMs != null && <span>{c.latencyMs} ms</span>}
                </div>
              )}
              {c.errorReason && c.state !== "CONNECTED" && (
                <div className="mt-1 truncate text-[10px] text-red-300/90" title={c.errorReason}>{c.errorReason}</div>
              )}
              <div className="mt-1.5 flex justify-between text-[10px] text-gray-500">
                <span>last check {c.lastCheckedTs ? fmt(c.lastCheckedTs) : "—"}</span>
                <span>calls: ok {m.success} · fail {m.failed}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* SELECTED PROVIDER RECENT ACTIVITY — directly below the cards, one at a
          time. scroll-mt keeps it off the very top edge after scrollIntoView. */}
      <div ref={panelRef} className="scroll-mt-4">
        {selectedDef ? (
          <div className="min-h-[240px] rounded-xl ring-1 ring-purple-500/30">
            <ProviderActivityPanel def={selectedDef} events={events} disconnected={disconnected} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center text-xs text-gray-500">
            Click a provider card above to view its recent activity timeline directly here.
          </div>
        )}
      </div>
    </div>
  );
}
