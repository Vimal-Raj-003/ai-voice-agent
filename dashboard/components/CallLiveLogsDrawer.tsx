"use client";

import { useEffect, useState, useMemo } from "react";
import Money from "./Money";
import {
  X,
  PhoneCall,
  Search,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  RotateCw,
  CalendarCheck,
  Loader2,
  ExternalLink,
} from "lucide-react";

export type CallItem = {
  id: string;
  room: string | null;
  status: string;
  outcome: string | null;
  phone: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  direction?: string | null;
  assistant: string | null;
  voice: string | null;
  llm: string | null;
  llmModel: string | null;
  stt: string | null;
  tts: string | null;
  createdAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  channel?:string;
  costUsd?:number;
  costStatus?:string;
};

function fmtDuration(secs: number | null | undefined): string {
  if (secs == null || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export default function CallLiveLogsDrawer({
  open,
  onClose,
  onSelectCall,
  selectedRoom,
}: {
  open: boolean;
  onClose: () => void;
  onSelectCall: (call: CallItem) => void;
  selectedRoom?: string | null;
}) {
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"ALL" | "DEMO" | "ACTIVE" | "BOOKED" | "COMPLETED" | "FAILED">("ALL");

  const loadCalls = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/voice/calls?limit=60", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalls(data.calls ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadCalls();
    }
  }, [open]);

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if(statusTab==='DEMO'&&c.channel!=='Demo')return false;
      if (statusTab === "ACTIVE") {
        if (!["IN_PROGRESS","RINGING","QUEUED"].includes(c.status)) return false;
      } else if (statusTab === "BOOKED") {
        if (c.outcome !== "BOOKED" && !c.status.includes("BOOKED")) return false;
      } else if (statusTab === "COMPLETED") {
        if (c.status !== "COMPLETED") return false;
      } else if (statusTab === "FAILED") {
        if (c.status !== "FAILED" && c.status !== "NO_ANSWER" && c.status !== "BUSY") return false;
      }

      if (!q) return true;
      const haystack = [
        c.phone,
        c.fromNumber,
        c.toNumber,
        c.room,
        c.id,
        c.assistant,
        c.status,
        c.outcome,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [calls, search, statusTab]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Body */}
      <div className="relative w-full max-w-lg border-l border-white/10 bg-[#0c0e17]/95 backdrop-blur-xl h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <PhoneCall size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Call live logs
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                  {calls.length} calls
                </span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Select any call to stream & inspect its complete pipeline logs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={loadCalls}
              disabled={loading}
              className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition"
              title="Refresh calls"
            >
              <RotateCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search & Tabs */}
        <div className="p-3 border-b border-white/10 space-y-2 bg-white/[0.01]">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone number, room, call ID or assistant…"
              className="w-full rounded-xl border border-white/10 bg-black/40 pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            {(
              [
                { key: "ALL", label: "All" },
                { key: "DEMO", label: "Demo" },
                { key: "ACTIVE", label: "Active" },
                { key: "BOOKED", label: "Booked" },
                { key: "COMPLETED", label: "Completed" },
                { key: "FAILED", label: "Failed" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatusTab(t.key)}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  statusTab === t.key
                    ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/40"
                    : "text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Call List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 font-sans">
          {loading && calls.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-500 flex flex-col items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin text-cyan-400" />
              <span>Loading call history…</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              <div className="font-semibold mb-1">Failed to load calls</div>
              <div>{error}</div>
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-500">
              No calls match the search or filter.
            </div>
          ) : (
            filteredCalls.map((call) => {
              const isSelected = selectedRoom && call.room === selectedRoom;
              const isActive = call.status === "IN_PROGRESS" || call.status === "RINGING";
              const isBooked = call.outcome === "BOOKED";
              const isInbound = call.direction === "INBOUND";

              return (
                <div
                  key={call.id}
                  onClick={() => onSelectCall(call)}
                  className={`group relative rounded-xl border p-3 cursor-pointer transition-all ${
                    isSelected
                      ? "border-cyan-500/60 bg-cyan-500/[0.08] shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`p-1.5 rounded-lg shrink-0 ${
                          isInbound
                            ? "bg-teal-500/10 text-teal-400 border border-teal-500/30"
                            : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30"
                        }`}
                        title={isInbound ? "Inbound Call" : "Outbound Call"}
                      >
                        {isInbound ? <PhoneIncoming size={12} /> : <PhoneOutgoing size={12} />}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-white truncate flex items-center gap-1.5">
                          <span>{call.phone || "Unknown Caller"}</span>
                          {isActive && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400 truncate">
                          {call.assistant || "Voice Agent"}
                          {call.channel==='Demo'&&<span className="ml-2 text-violet-300">Demo</span>}
                          {(call.costStatus==='estimated'||(call.costStatus==='incomplete'&&(call.costUsd||0)>0))&&<span className="ml-2"><Money usd={call.costUsd||0} decimals={4}/>{call.costStatus==='incomplete'?' + unmetered':''}</span>}
                          {call.costStatus==='incomplete'&&<span className="ml-2">Cost incomplete</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isBooked && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                          <CalendarCheck size={10} /> BOOKED
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          call.status === "COMPLETED"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                            : isActive
                            ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                            : call.status === "FAILED"
                            ? "border-red-500/30 bg-red-500/10 text-red-300"
                            : "border-white/10 bg-white/5 text-gray-400"
                        }`}
                      >
                        {call.status}
                      </span>
                    </div>
                  </div>

                  {/* Room ID & Time */}
                  <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500 font-mono pt-1.5 border-t border-white/5">
                    <span className="truncate max-w-[200px]" title={call.room ?? call.id}>
                      {call.room ? call.room.slice(0, 24) + "…" : call.id.slice(0, 16)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {call.durationSeconds != null && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Clock size={10} />
                          {fmtDuration(call.durationSeconds)}
                        </span>
                      )}
                      <span>
                        {call.createdAt ? TIME_FMT.format(new Date(call.createdAt)) : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Action prompt */}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-cyan-300 font-medium">
                    <span className="group-hover:underline">
                      {isSelected ? "Currently viewing live logs" : "Click to view live logs →"}
                    </span>
                    <a
                      href={`/calls/${call.id}/logs`}
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-gray-400 hover:text-white p-1 rounded hover:bg-white/10 transition"
                      title="Open full call page in new tab"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
