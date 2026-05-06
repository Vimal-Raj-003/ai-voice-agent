"use client";
import { useEffect, useRef, useState } from "react";

type Log = { id: string; source: string; level: string; message: string; detail?: string; timestamp: string };

export default function LiveLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const es = new EventSource("/api/logs/proxy");
    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const l = JSON.parse(e.data) as Log;
        setLogs((prev) => [...prev.slice(-499), l]);
      } catch {}
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, []);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [logs]);
  return (
    <div ref={ref} className="rounded-2xl border border-white/10 bg-black/40 h-[60vh] overflow-y-auto p-3 font-mono text-xs">
      {logs.length === 0 && <div className="text-gray-500">Waiting for logs…</div>}
      {logs.map((l) => (
        <div key={l.id} className={`py-0.5 ${l.level === "ERROR" || l.level === "CRITICAL" ? "text-red-400" : l.level === "WARNING" ? "text-yellow-400" : "text-gray-300"}`}>
          <span className="text-gray-600">[{new Date(l.timestamp).toLocaleTimeString()}]</span>{" "}
          <span className="text-purple-300">{l.source}</span>{" "}
          {l.message}
          {l.detail && <span className="text-gray-500"> — {l.detail}</span>}
        </div>
      ))}
    </div>
  );
}
