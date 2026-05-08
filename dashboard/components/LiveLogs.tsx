"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  Search,
  Trash2,
  Copy,
  Check,
  ArrowDown,
  Wifi,
  WifiOff,
} from "lucide-react";

type Log = {
  id: string;
  source: string;
  level: string;
  message: string;
  detail?: string;
  timestamp: string;
};

type ConnState = "connecting" | "open" | "closed";

const MAX_BUFFER = 2000;
const LEVEL_OPTIONS = ["INFO", "WARNING", "ERROR", "CRITICAL", "DEBUG"] as const;

export default function LiveLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set());
  const [activeSource, setActiveSource] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [copied, setCopied] = useState(false);

  const bufferRef = useRef<Log[]>([]);
  const pausedRef = useRef(paused);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep paused ref in sync without re-creating SSE on every paused toggle.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // SSE connection — recreated only when component mounts.
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setConn("connecting");
      es = new EventSource("/api/logs/proxy");
      es.onopen = () => setConn("open");
      es.addEventListener("log", (e: MessageEvent) => {
        if (pausedRef.current) return;
        try {
          const l = JSON.parse(e.data) as Log;
          bufferRef.current = [...bufferRef.current.slice(-(MAX_BUFFER - 1)), l];
          setLogs(bufferRef.current);
        } catch {
          // Ignore malformed events
        }
      });
      es.onerror = () => {
        setConn("closed");
        es?.close();
        // Reconnect with a small backoff so transient blips self-heal.
        if (!cancelled) setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  // Auto-scroll: only when user is parked at the bottom. If they scroll up,
  // we stop chasing and let them inspect old lines.
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const l of logs) s.add(l.source);
    return Array.from(s).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (activeLevels.size > 0 && !activeLevels.has(l.level)) return false;
      if (activeSource && l.source !== activeSource) return false;
      if (!q) return true;
      return (
        l.message.toLowerCase().includes(q) ||
        (l.detail?.toLowerCase().includes(q) ?? false) ||
        l.source.toLowerCase().includes(q)
      );
    });
  }, [logs, search, activeLevels, activeSource]);

  const toggleLevel = (lvl: string) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  };

  const onClear = () => {
    bufferRef.current = [];
    setLogs([]);
  };

  const onCopy = async () => {
    const text = filtered
      .map(
        (l) =>
          `[${new Date(l.timestamp).toISOString()}] ${l.level.padEnd(8)} ${l.source} — ${l.message}${l.detail ? " | " + l.detail : ""}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — silent fail
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-wide ${
            conn === "open"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : conn === "connecting"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
          title={`SSE: ${conn}`}
        >
          {conn === "closed" ? <WifiOff size={10} /> : <Wifi size={10} />}
          {conn}
        </span>

        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 ${
            paused ? "text-amber-300" : "text-gray-300"
          }`}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? "Resume" : "Pause"}
        </button>

        <div className="flex items-center gap-1">
          {LEVEL_OPTIONS.map((lvl) => {
            const active = activeLevels.has(lvl);
            const tone =
              lvl === "ERROR" || lvl === "CRITICAL"
                ? "text-red-300 border-red-500/40"
                : lvl === "WARNING"
                  ? "text-yellow-300 border-yellow-500/40"
                  : "text-gray-300 border-white/15";
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                className={`rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wide transition ${tone} ${
                  active ? "bg-white/10" : "bg-transparent hover:bg-white/5"
                }`}
              >
                {lvl}
              </button>
            );
          })}
        </div>

        <select
          value={activeSource}
          onChange={(e) => setActiveSource(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-white/10 bg-black/40 pl-7 pr-2 py-1 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
          />
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/10"
          title="Copy filtered logs to clipboard"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>

        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400 hover:text-red-300 hover:bg-white/10"
          title="Clear local buffer"
        >
          <Trash2 size={12} />
          Clear
        </button>

        <span className="ml-auto text-[10px] font-mono text-gray-500">
          {filtered.length}
          {filtered.length !== logs.length && (
            <span className="text-gray-600"> / {logs.length}</span>
          )}
          <span className="text-gray-600"> shown</span>
        </span>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="rounded-2xl border border-white/10 bg-black/40 h-[60vh] overflow-y-auto p-3 font-mono text-xs"
        >
          {filtered.length === 0 && (
            <div className="text-gray-500">
              {logs.length === 0
                ? "Waiting for logs…"
                : "No logs match the current filter."}
            </div>
          )}
          {filtered.map((l) => (
            <div
              key={l.id}
              className={`py-0.5 ${
                l.level === "ERROR" || l.level === "CRITICAL"
                  ? "text-red-400"
                  : l.level === "WARNING"
                    ? "text-yellow-400"
                    : "text-gray-300"
              }`}
            >
              <span className="text-gray-600">
                [{new Date(l.timestamp).toLocaleTimeString()}]
              </span>{" "}
              <span className="text-purple-300">{l.source}</span>{" "}
              {l.message}
              {l.detail && <span className="text-gray-500"> — {l.detail}</span>}
            </div>
          ))}
        </div>

        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
            }}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] text-gray-300 hover:text-white hover:bg-black/90 backdrop-blur"
          >
            <ArrowDown size={10} /> Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
