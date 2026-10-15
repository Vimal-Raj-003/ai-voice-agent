"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, Loader2, User } from "lucide-react";
import { searchContacts, type ContactHit } from "@/app/(admin)/contacts/actions";

// Contact autocomplete for the dialer. Type a name / phone / email → pick a
// saved contact → onSelect fills the dialer's phone field. Reads the existing
// Contact table only (no samples). Debounced, keyboard-navigable.
export default function ContactSearch({
  onSelect,
}: {
  onSelect: (phone: string, name: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const lastQ = useRef("");

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    lastQ.current = q;
    if (!q) { setResults([]); setOpen(false); return; }
    const t = setTimeout(() => {
      start(async () => {
        const r = await searchContacts(q);
        if (lastQ.current !== q) return; // stale response guard
        setResults(r);
        setActive(0);
        setOpen(true);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (c: ContactHit) => {
    onSelect(c.phoneNumber, c.name);
    setQuery(c.name || c.phoneNumber);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); const c = results[active]; if (c) pick(c); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={boxRef} className="relative mb-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Search saved contact (name or number)…"
          autoComplete="off"
          className="w-full rounded-lg border border-white/15 bg-black/40 py-2 pl-9 pr-8 text-sm text-white placeholder:text-gray-500 focus:border-emerald-400/50 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        />
        {pending && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-white/15 bg-[#11131f] shadow-2xl">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-500">No contacts found</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((c, i) => (
                <li key={c.phoneNumber}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(c)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${i === active ? "bg-emerald-500/15" : "hover:bg-white/[0.05]"}`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-gray-300">
                      <User size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{c.name || "Unnamed"}</span>
                      <span className="block truncate text-xs text-gray-400">
                        <span className="font-mono">{c.phoneNumber}</span>
                        {c.email && <span> · {c.email}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
