"use client";
// The ONE shared client stream over the ONE backend event bus
// (/api/logs/proxy → voice-service /api/logs/stream + the jj-live-log client bus).
// Live Logs and every provider card/panel consume the SAME stream via this hook;
// no per-provider polling (req 27). Pure normalization lives in eventModel.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LiveEvent, categorize, deriveStatus, parseMeta, fingerprint,
} from "./eventModel";

export type { LiveEvent, Category, Status } from "./eventModel";
export { categorize, deriveStatus, parseMeta, mf } from "./eventModel";

export type ConnState = "connecting" | "reconnecting" | "open" | "closed" | "error";

const MAX_BUFFER = 3000;

export type UseLiveEvents = {
  events: LiveEvent[];
  conn: ConnState;
  connErr: string;
  startedAt: number | null;
  lastEventAt: number | null;
  nowMs: number | null;
  paused: boolean;
  setPaused: (p: boolean) => void;
  clear: () => void;
};

// Mount once per page; both Live Logs and the Providers page derive their views
// from the returned `events` array.
export function useLiveEvents(): UseLiveEvents {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [connErr, setConnErr] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [paused, setPausedState] = useState(false);

  const bufferRef = useRef<LiveEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const sessionStartRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const setPaused = useCallback((p: boolean) => { pausedRef.current = p; setPausedState(p); }, []);

  const startSession = useCallback(() => {
    sessionStartRef.current = Date.now();
    setStartedAt(sessionStartRef.current);
  }, []);
  useEffect(() => { startSession(); }, [startSession]);   // before the SSE effect

  const ingest = useCallback((raw: { source?: string; level?: string; message?: string; detail?: string; timestamp?: string; synthetic?: boolean }) => {
    if (pausedRef.current) return;
    const ts = raw.timestamp ? Date.parse(raw.timestamp) : Date.now();
    const tsMs = Number.isFinite(ts) ? ts : Date.now();
    if (!raw.synthetic && tsMs < sessionStartRef.current - 250) return;    // session boundary
    const source = String(raw.source || "");
    const level = String(raw.level || "INFO");
    const message = String(raw.message || "");
    const meta = parseMeta(raw.detail);
    const fp = fingerprint(raw.timestamp || tsMs, message, meta, source);
    if (seenRef.current.has(fp)) return;
    seenRef.current.add(fp);
    if (seenRef.current.size > MAX_BUFFER * 2) seenRef.current = new Set(bufferRef.current.map((x) => x.id));
    const ev: LiveEvent = {
      id: fp, source, level, status: deriveStatus(level, message), message, detail: raw.detail,
      timestamp: raw.timestamp || new Date(tsMs).toISOString(), ts: tsMs,
      category: categorize(source, message, level), meta, synthetic: raw.synthetic,
    };
    bufferRef.current = [...bufferRef.current.slice(-(MAX_BUFFER - 1)), ev];
    setEvents(bufferRef.current);
    setLastEventAt(Date.now());
  }, []);

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

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const clear = useCallback(() => {
    bufferRef.current = []; seenRef.current = new Set();
    setEvents([]); setLastEventAt(null); startSession();
  }, [startSession]);

  return useMemo(() => ({ events, conn, connErr, startedAt, lastEventAt, nowMs, paused, setPaused, clear }),
    [events, conn, connErr, startedAt, lastEventAt, nowMs, paused, setPaused, clear]);
}
