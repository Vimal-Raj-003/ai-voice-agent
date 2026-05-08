"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

type Option = { value: string; label: string };

const DIRECTIONS: Option[] = [
  { value: "", label: "All directions" },
  { value: "INBOUND", label: "Inbound" },
  { value: "OUTBOUND", label: "Outbound" },
];

const STATUSES: Option[] = [
  { value: "", label: "All statuses" },
  { value: "QUEUED", label: "Queued" },
  { value: "RINGING", label: "Ringing" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "BUSY", label: "Busy" },
  { value: "CANCELED", label: "Canceled" },
];

const OUTCOMES: Option[] = [
  { value: "", label: "All outcomes" },
  { value: "BOOKED", label: "Booked" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
  { value: "VOICEMAIL", label: "Voicemail" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "CALLBACK_REQUESTED", label: "Callback requested" },
  { value: "TRANSFERRED", label: "Transferred" },
  { value: "FAILED", label: "Failed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "OPT_OUT", label: "Opt-out" },
];

export default function CallsFilters({
  assistants,
}: {
  assistants: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQ(sp.get("q") ?? "");
  }, [sp]);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.replace(`/calls?${params.toString()}`, { scroll: false });
  };

  const onQ = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParam("q", v), 250);
  };

  const clearAll = () => router.replace("/calls", { scroll: false });
  const hasAny =
    sp.get("q") ||
    sp.get("direction") ||
    sp.get("status") ||
    sp.get("outcome") ||
    sp.get("assistantId") ||
    sp.get("from") ||
    sp.get("to");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Search transcripts and notes…"
            className="w-full rounded-lg border border-white/10 bg-black/30 pl-7 pr-2 py-1.5 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>
        <select
          value={sp.get("direction") ?? ""}
          onChange={(e) => setParam("direction", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          {DIRECTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sp.get("status") ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sp.get("outcome") ?? ""}
          onChange={(e) => setParam("outcome", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sp.get("assistantId") ?? ""}
          onChange={(e) => setParam("assistantId", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          <option value="">All assistants</option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={sp.get("from") ?? ""}
          onChange={(e) => setParam("from", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={sp.get("to") ?? ""}
          onChange={(e) => setParam("to", e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        />
        {hasAny && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
