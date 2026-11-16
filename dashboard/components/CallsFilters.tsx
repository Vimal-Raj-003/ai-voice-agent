"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";

type Option = { value: string; label: string };

// Visible channel options filter the same call history and preserve its URLs.
const DIRECTIONS: Option[] = [
  { value: "INBOUND", label: "Inbound" },
  { value: "OUTBOUND", label: "Outbound" },
  { value: "DEMO", label: "Demo" },
  { value: "", label: "All calls" },
];

// Params whose UI controls were removed (status / outcome / date). They are
// stripped from every URL this component builds so a stale link such as
// ?status=FAILED cannot keep filtering the list invisibly once there is no
// control left to clear it. The matching server-side `where` clauses were
// removed too — these backend STATUS/OUTCOME values themselves are untouched
// and still drive call processing.
const DROPPED_PARAMS = ["status", "outcome", "from", "to", "assistantId"] as const;

/**
 * `basePath` / `keep` let this render either at its own route or embedded as a
 * section of another page (Contacts → ?section=calls). Both default to the
 * standalone behaviour.
 */
export default function CallsFilters({
  basePath = "/calls",
  keep = {},
}: {
  basePath?: string;
  keep?: Record<string, string>;
} = {}) {
  const router = useRouter();
  const sp = useSearchParams();
  const rawQuery=sp.get('q')??'';
  const [query,setQuery]=useState({source:rawQuery,value:rawQuery});
  if(query.source!==rawQuery)setQuery({source:rawQuery,value:rawQuery});
  const q=query.value;
  const setQ=(value:string)=>setQuery({source:rawQuery,value});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(()=>()=>{if(debounce.current)clearTimeout(debounce.current);},[]);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    for (const dead of DROPPED_PARAMS) params.delete(dead);
    // Re-assert the host-section params (e.g. section=calls) so a tab or search
    // change can never navigate out of the section it is embedded in.
    for (const [k, v] of Object.entries(keep)) params.set(k, v);
    router.replace(`${basePath}?${params.toString()}`, { scroll: false });
  };

  // Unchanged 250 ms debounce so typing does not fire a request per keystroke.
  const onQ = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParam("q", v), 250);
  };

  const direction = sp.get("direction") ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Call type" className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {DIRECTIONS.map(option=><button key={option.value||'all'} type="button" aria-pressed={direction===option.value}
          onClick={()=>setParam('direction',option.value)}
          className={`min-h-9 rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${direction===option.value?'bg-white/[0.08] text-white':'text-gray-400 hover:bg-white/[0.04] hover:text-white'}`}>
          {option.label}
        </button>)}
      </div>
      <div className="relative w-full max-w-md">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          aria-label="Search calls"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search calls…"
          className="w-full rounded-lg border border-white/10 bg-black/30 pl-7 pr-2 py-1.5 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </div>
    </div>
  );
}
