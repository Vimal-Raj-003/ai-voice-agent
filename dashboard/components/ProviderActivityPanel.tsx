"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, ChevronRight, Search, Loader2, RotateCw } from "lucide-react";
import {
  type LiveEvent, mf, parseMeta, deriveStatus, categorize, fingerprint,
} from "@/lib/eventModel";
import { type ProviderDef, matchProvider } from "@/lib/providerRegistry";

const TIME_FMT = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
const fmt = (ms: number | null) => (ms == null ? "—" : TIME_FMT.format(ms));

type DiagStep = { name: string; ok: boolean | null; detail?: string };
type DiagResult = {
  status?: "healthy" | "warning" | "failed"; steps?: DiagStep[];
  latency_ms?: number; http_status?: number | null; model?: string; endpoint?: string;
  language?: string; summary?: string; warning?: string;
  breakpoint?: string; root_cause?: string; impact?: string; error?: string; retryable?: boolean;
  request?: Record<string, unknown>; response?: Record<string, unknown>;
};

const EXPLICIT_ACTIONS: Record<string, string> = {
  TELEPHONY: "Place Test Call", MESSAGING: "Send Test Message",
  CALENDAR: "Create Test Booking", STORAGE: "Run Upload Test", STT: "Run Streaming Test",
};

const isDiag = (e: LiveEvent) => mf(e.meta, "traffic_type") === "diagnostic";

function rowStatus(e: LiveEvent): { t: string; cls: string } {
  if (e.status === "ERROR" || e.status === "CRITICAL") return { t: "ERROR", cls: "text-red-300" };
  if (e.status === "SUCCESS") return { t: "SUCCESS", cls: "text-emerald-300" };
  if (e.status === "WARNING") return { t: "WARN", cls: "text-yellow-300" };
  return { t: "OK", cls: "text-gray-400" };
}

function rowDetails(e: LiveEvent): string {
  const m = e.meta; const parts: string[] = [];
  const prov = mf(m, "provider", "tts_provider"); const model = mf(m, "model");
  if (prov) parts.push(model ? `${prov}/${model}` : prov); else if (model) parts.push(model);
  const lang = mf(m, "language", "stt_language"); if (lang) parts.push(lang);
  const cid = mf(m, "call_id", "room"); if (cid) parts.push(cid);
  const http = mf(m, "http_status", "status_code"); if (http) parts.push(`HTTP ${http}`);
  const txt = mf(m, "transcript", "text"); if (txt) parts.push(`"${txt.slice(0, 48)}"`);
  if (e.status === "ERROR" || e.status === "CRITICAL") { const err = mf(m, "error", "root_cause", "reason", "detail"); if (err) parts.push(err.slice(0, 80)); }
  return parts.join(" · ") || "—";
}

function rawToEvent(r: { id?: string; source?: string; level?: string; message?: string; detail?: string; timestamp?: string }): LiveEvent {
  const ts = r.timestamp ? Date.parse(r.timestamp) : Date.now();
  const tsMs = Number.isFinite(ts) ? ts : Date.now();
  const source = String(r.source || ""); const level = String(r.level || "INFO"); const message = String(r.message || "");
  const meta = parseMeta(r.detail);
  return {
    id: fingerprint(r.timestamp || tsMs, message, meta, source), source, level,
    status: deriveStatus(level, message), message, detail: r.detail,
    timestamp: r.timestamp || new Date(tsMs).toISOString(), ts: tsMs,
    category: categorize(source, message, level), meta,
  };
}

// Merge persisted + live, dedupe tolerant of timestamp-format differences
// (python isoformat vs JS toISOString), newest-first.
function mergeDedupe(a: LiveEvent[], b: LiveEvent[]): LiveEvent[] {
  const map = new Map<string, LiveEvent>();
  for (const e of [...a, ...b]) {
    const k = `${Math.round(e.ts / 1000)}|${e.message}|${mf(e.meta, "call_id", "room")}|${mf(e.meta, "turn_id")}|${e.source}`;
    const prev = map.get(k);
    if (!prev || e.ts >= prev.ts) map.set(k, e);
  }
  return [...map.values()].sort((x, y) => y.ts - x.ts);
}

type Stats = { total: number; ok: number; fail: number; avg: number | null; lastOk: number | null; lastFail: number | null; status: "healthy" | "warning" | "failed" | "none" };
function deriveStats(evsDesc: LiveEvent[]): Stats {
  const ok = evsDesc.filter((e) => e.status === "SUCCESS").length;
  const fail = evsDesc.filter((e) => e.status === "ERROR" || e.status === "CRITICAL").length;
  const lats = evsDesc.map((e) => Number(mf(e.meta, "latency_ms", "total_ms", "elapsed_ms"))).filter((n) => Number.isFinite(n) && n > 0);
  const avg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  const lastOk = evsDesc.find((e) => e.status === "SUCCESS")?.ts ?? null;
  const lastFail = evsDesc.find((e) => e.status === "ERROR" || e.status === "CRITICAL")?.ts ?? null;
  const status: Stats["status"] = evsDesc.length === 0 ? "none"
    : lastFail && (!lastOk || lastFail >= lastOk) ? "failed" : lastOk ? "healthy" : "warning";
  return { total: evsDesc.length, ok, fail, avg, lastOk, lastFail, status };
}

const STATUS_WORD: Record<Stats["status"] | "disconnected", { t: string; cls: string }> = {
  healthy: { t: "HEALTHY", cls: "text-emerald-300" }, warning: { t: "WARNING", cls: "text-yellow-300" },
  failed: { t: "FAILED", cls: "text-red-300" }, none: { t: "NO ACTIVITY", cls: "text-gray-400" },
  disconnected: { t: "LIVE DATA DISCONNECTED", cls: "text-red-300" },
};

export default function ProviderActivityPanel({
  def, events, disconnected,
}: { def: ProviderDef; events: LiveEvent[]; disconnected: boolean }) {
  const [tab, setTab] = useState<"recent" | "session" | "test">("recent");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [q, setQ] = useState("");
  const [callFilter, setCallFilter] = useState("");
  const [copied, setCopied] = useState("");
  const [showInspector, setShowInspector] = useState(false);

  // Live (current-session) provider traffic, diagnostics split out.
  const provEvents = useMemo(() => events.filter((e) => matchProvider(def, e)), [events, def]);
  const realLive = useMemo(() => provEvents.filter((e) => !isDiag(e)), [provEvents]);
  const testLive = useMemo(() => provEvents.filter(isDiag), [provEvents]);

  // PERSISTED recent activity — fetched IMMEDIATELY on provider select (default
  // view), not gated behind a tab. Latest real rows from the DB.
  const [persisted, setPersisted] = useState<LiveEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setPersisted(null); setLoading(true); setTab("recent");
    fetch(`/api/providers/${encodeURIComponent(def.key)}/history?take=1000`)
      .then((r) => r.json())
      .then((d: { rows?: unknown[] }) => {
        if (cancelled) return;
        const evs = (d.rows || []).map((r) => rawToEvent(r as Parameters<typeof rawToEvent>[0]))
          .filter((e) => matchProvider(def, e) && !isDiag(e));
        setPersisted(evs);
      })
      .catch(() => { if (!cancelled) setPersisted([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [def.key]);

  // Recent activity = persisted + live merged (deduped, newest-first).
  const merged = useMemo(() => mergeDedupe(persisted ?? [], realLive), [persisted, realLive]);
  const recentStats = useMemo(() => deriveStats(merged), [merged]);

  // Explicit diagnostic (Test tab only — NEVER on select/card click).
  const [testing, setTesting] = useState(false);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [lastTested, setLastTested] = useState<number | null>(null);
  const inFlight = useRef(false);
  const runTest = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setTesting(true); setDiag(null);
    try {
      const r = await fetch(`/api/providers/${encodeURIComponent(def.key)}/diagnose`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "safe" }),
      });
      setDiag(await r.json());
    } catch (e) {
      setDiag({ status: "failed", breakpoint: "diagnostic_backend", root_cause: "request failed", error: e instanceof Error ? e.message : String(e) });
    } finally { setLastTested(Date.now()); setTesting(false); inFlight.current = false; }
  }, [def.key]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1200); }).catch(() => {});
  };

  const descReal = useMemo(() => [...realLive].sort((a, b) => b.ts - a.ts), [realLive]);
  const descTest = useMemo(() => [...testLive].sort((a, b) => b.ts - a.ts), [testLive]);
  const sourceEvents = tab === "recent" ? merged : tab === "session" ? descReal : descTest;

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase(); const cf = callFilter.trim().toLowerCase();
    return sourceEvents
      .filter((e) => (!errorsOnly || e.status === "ERROR" || e.status === "CRITICAL"))
      .filter((e) => (!cf || `${mf(e.meta, "call_id", "room")} ${mf(e.meta, "campaign_id")} ${mf(e.meta, "job_id")} ${mf(e.meta, "turn_id")}`.toLowerCase().includes(cf)))
      .filter((e) => (!ql || e.message.toLowerCase().includes(ql) || (e.detail?.toLowerCase().includes(ql) ?? false)))
      .slice(0, 150);
  }, [sourceEvents, errorsOnly, q, callFilter]);

  const strip = disconnected ? STATUS_WORD.disconnected : STATUS_WORD[recentStats.status];
  const TABS: [typeof tab, string][] = [["recent", "Recent activity"], ["session", "Current session"], ["test", "Test"]];
  const recentLoading = tab === "recent" && loading && persisted === null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs">
      {/* HEADER */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tracking-wide text-gray-100">{def.label.toUpperCase()} — RECENT ACTIVITY</span>
        <span className="ml-auto flex gap-1">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide ${tab === t ? "border-purple-500/50 bg-purple-500/15 text-purple-200" : "border-white/15 text-gray-400 hover:bg-white/5"}`}>
              {label}
            </button>
          ))}
        </span>
      </div>

      {/* status strip — reflects the recent (persisted + live) timeline */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/5 pb-2 font-mono text-[10px] text-gray-500">
        <span className={`font-semibold uppercase ${strip.cls}`}>{strip.t}</span>
        <span>events <span className="text-gray-300">{recentStats.total}</span></span>
        <span>ok <span className="text-emerald-300">{recentStats.ok}</span></span>
        <span>fail <span className="text-red-300">{recentStats.fail}</span></span>
        <span>avg <span className="text-gray-300">{recentStats.avg == null ? "—" : `${recentStats.avg}ms`}</span></span>
        <span>last success <span className="text-gray-300">{fmt(recentStats.lastOk)}</span></span>
        <span>last fail <span className="text-gray-300">{fmt(recentStats.lastFail)}</span></span>
      </div>

      {/* TEST TAB: explicit diagnostic (never auto) */}
      {tab === "test" && (
        <DiagnosticSection def={def} testing={testing} diag={diag} lastTested={lastTested} onRetest={runTest}
          showInspector={showInspector} setShowInspector={setShowInspector} copy={copy} copied={copied} />
      )}

      {/* CONTROLS */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setErrorsOnly((v) => !v)} className={`rounded-md border px-2 py-0.5 text-[10px] uppercase ${errorsOnly ? "border-red-500/50 bg-red-500/15 text-red-300" : "border-white/15 text-gray-400 hover:bg-white/5"}`}>Errors only</button>
        <input value={callFilter} onChange={(e) => setCallFilter(e.target.value)} placeholder="call_id / room / job / turn" className="w-[170px] rounded border border-white/10 bg-black/40 px-2 py-0.5 text-[11px] text-gray-200 placeholder:text-gray-600" />
        <div className="relative min-w-[110px] flex-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search events" className="w-full rounded border border-white/10 bg-black/40 pl-6 pr-2 py-0.5 text-[11px] text-gray-200 placeholder:text-gray-600" />
        </div>
        <span className="text-[10px] font-mono text-gray-500">{rows.length} shown</span>
      </div>

      {/* TIMELINE — Time | Event | Status | Latency | Details */}
      <div className="overflow-hidden rounded-lg border border-white/10">
        <div className="grid grid-cols-[82px_minmax(0,1.3fr)_72px_72px_minmax(0,1.6fr)] gap-2 bg-white/[0.03] px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-gray-500">
          <span>Time</span><span>Event</span><span>Status</span><span>Latency</span><span>Details</span>
        </div>
        <div className="max-h-[360px] overflow-y-auto font-mono">
          {recentLoading && <div className="px-2 py-3 text-gray-500"><Loader2 size={11} className="mr-1 inline animate-spin" />Loading recent {def.label} activity…</div>}
          {!recentLoading && rows.map((e) => <ActivityRow key={e.id} e={e} copy={copy} copied={copied} />)}
          {!recentLoading && rows.length === 0 && (
            <div className="px-2 py-3 text-gray-500">
              {tab === "test" ? "No test runs yet — press Run test above." :
               tab === "session" ? "No activity in the current live session yet." :
               `No recent runtime activity for ${def.label}.`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ e, copy, copied }: { e: LiveEvent; copy: (t: string, k: string) => void; copied: string }) {
  const [open, setOpen] = useState(false);
  const s = rowStatus(e);
  const lat = mf(e.meta, "latency_ms", "total_ms", "elapsed_ms", "first_token_to_first_audio_ms");
  const details = rowDetails(e);
  const diag = mf(e.meta, "traffic_type") === "diagnostic";
  const isErr = s.t === "ERROR";
  return (
    <div className={`border-t border-white/5 ${isErr ? "bg-red-500/[0.05]" : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="grid w-full grid-cols-[82px_minmax(0,1.3fr)_72px_72px_minmax(0,1.6fr)] items-start gap-2 px-2 py-1 text-left hover:bg-white/5">
        <span className="truncate text-gray-600">{TIME_FMT.format(e.ts)}</span>
        <span className="min-w-0 break-words text-gray-200">
          {diag && <span className="mr-1 rounded bg-sky-500/20 px-1 text-[9px] font-semibold text-sky-300">TEST</span>}
          {e.message}
          {e.meta && <ChevronRight size={10} className={`ml-1 inline text-gray-600 ${open ? "rotate-90" : ""}`} />}
        </span>
        <span className={`font-semibold ${s.cls}`}>{s.t}</span>
        <span className="tabular-nums text-gray-400">{lat ? `${lat} ms` : "—"}</span>
        <span className={`min-w-0 break-words ${isErr ? "text-red-300/90" : "text-gray-400"}`}>{details}</span>
      </button>
      {open && e.meta && (
        <div className="border-t border-white/5 bg-black/60 px-2 py-1.5">
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
            {(["call_id", "room", "job_id", "turn_id", "provider", "model", "http_status", "status_code", "language"] as const).map((k) => {
              const v = mf(e.meta, k); if (!v) return null;
              return <span key={k}>{k}=<span className="text-gray-300">{v}</span></span>;
            })}
            {mf(e.meta, "call_id", "room") && <button type="button" onClick={() => copy(mf(e.meta, "call_id", "room"), "row-" + e.id)} className="text-gray-500 hover:text-gray-300">{copied === "row-" + e.id ? "copied" : "copy call_id"}</button>}
          </div>
          <pre className="overflow-x-auto text-[10px] text-gray-400">{JSON.stringify(e.meta, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function DiagnosticSection({
  def, testing, diag, lastTested, onRetest, showInspector, setShowInspector, copy, copied,
}: {
  def: ProviderDef; testing: boolean; diag: DiagResult | null; lastTested: number | null;
  onRetest: () => void; showInspector: boolean; setShowInspector: (v: boolean) => void;
  copy: (t: string, k: string) => void; copied: string;
}) {
  const status = diag?.status;
  const badge = testing ? { t: "TESTING…", c: "text-amber-300 bg-amber-500/15 border-amber-500/40" }
    : status === "healthy" ? { t: "HEALTHY", c: "text-emerald-300 bg-emerald-500/15 border-emerald-500/40" }
    : status === "warning" ? { t: "WARNING", c: "text-yellow-300 bg-yellow-500/15 border-yellow-500/40" }
    : status === "failed" ? { t: "FAILED", c: "text-red-300 bg-red-500/15 border-red-500/40" }
    : { t: "NOT RUN", c: "text-gray-400 bg-white/5 border-white/15" };
  const explicit = EXPLICIT_ACTIONS[def.kind];

  return (
    <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Safe diagnostic (explicit)</span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase ${badge.c}`}>
          {testing && <Loader2 size={9} className="mr-1 inline animate-spin" />}{badge.t}
        </span>
        {diag && !testing && (
          <span className="flex flex-wrap gap-2 font-mono text-[10px] text-gray-400">
            {diag.http_status != null && <span>HTTP {diag.http_status}</span>}
            {diag.latency_ms != null && <span>{diag.latency_ms}ms</span>}
            {diag.model && <span>{diag.model}</span>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {lastTested && <span className="text-[10px] text-gray-500">last tested {TIME_FMT.format(lastTested)}</span>}
          <button type="button" onClick={onRetest} disabled={testing}
            className="inline-flex items-center gap-1 rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-200 hover:bg-purple-500/20 disabled:opacity-40">
            <RotateCw size={10} className={testing ? "animate-spin" : ""} /> {diag ? "Run test again" : "Run test"}
          </button>
        </span>
      </div>
      {!diag && !testing && <div className="text-[11px] text-gray-500">This runs ONE real, safe provider probe. It does not place calls or spend tokens.</div>}
      {diag?.steps && diag.steps.length > 0 && (
        <div className="mb-2 space-y-0.5 font-mono text-[11px]">
          {diag.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2"><span>{s.ok === true ? "✅" : s.ok === false ? "❌" : "•"}</span><span className={s.ok === false ? "text-red-300" : "text-gray-300"}>{s.name}</span>{s.detail && <span className="text-gray-600">· {s.detail}</span>}</div>
          ))}
        </div>
      )}
      {status === "failed" && (
        <div className="mb-2 rounded border border-red-500/30 bg-red-500/[0.06] p-2 text-[11px]">
          {diag?.breakpoint && <div className="text-red-300"><span className="text-gray-500">BREAKPOINT:</span> {diag.breakpoint}</div>}
          {diag?.root_cause && <div className="text-gray-300"><span className="text-gray-500">ROOT CAUSE:</span> {diag.root_cause}</div>}
          {diag?.impact && <div className="text-gray-400"><span className="text-gray-500">IMPACT:</span> {diag.impact}</div>}
          {diag?.error && <div className="mt-0.5 break-words text-red-300/80">{diag.error}</div>}
        </div>
      )}
      {status === "warning" && diag?.warning && <div className="mb-2 rounded border border-yellow-500/30 bg-yellow-500/[0.06] p-2 text-[11px] text-yellow-300">{diag.warning}</div>}
      {status === "healthy" && diag?.summary && <div className="mb-2 text-[11px] text-emerald-300/90">{diag.summary}</div>}
      {diag && (diag.request || diag.response) && (
        <div className="text-[11px]">
          <button type="button" onClick={() => setShowInspector(!showInspector)} className="text-gray-500 hover:text-gray-300">{showInspector ? "▾" : "▸"} request / response inspector</button>
          {showInspector && (
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <pre className="overflow-x-auto rounded border border-white/10 bg-black/60 p-2 text-[10px] text-gray-400">REQUEST{"\n"}{JSON.stringify(diag.request ?? {}, null, 2)}</pre>
              <pre className="overflow-x-auto rounded border border-white/10 bg-black/60 p-2 text-[10px] text-gray-400">RESPONSE{"\n"}{JSON.stringify(diag.response ?? {}, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      {explicit && (
        <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-2">
          <button type="button" disabled title="Explicit chargeable/external action — not enabled in this build"
            className="cursor-not-allowed rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] uppercase text-amber-300/70">{explicit}</button>
          <span className="text-[10px] text-gray-500">chargeable / external — separate from the safe test</span>
        </div>
      )}
    </div>
  );
}
