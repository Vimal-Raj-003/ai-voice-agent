"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Calendar } from "lucide-react";

import { RANGE_OPTIONS, type RangeKey } from "@/lib/overview-range";
export { RANGE_OPTIONS, type RangeKey } from "@/lib/overview-range";

export default function RangeSelector({ currentRange = "14d" }: { currentRange?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected =
    RANGE_OPTIONS.find((o) => o.value === currentRange) ?? RANGE_OPTIONS[2];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectRange = (value: RangeKey) => {
    setOpen(false);
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (value === "14d") {
      params.delete("range");
    } else {
      params.set("range", value);
    }
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  };

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 px-3.5 py-1.5 text-xs font-medium text-gray-200 transition-all shadow-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Calendar size={13} className="text-gray-400 shrink-0" />
        <span>{selected.label}</span>
        <ChevronDown
          size={13}
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180 text-cyan-400" : ""
          }`}
        />
      </button>

      {open && (
        <div className="bg-elevated absolute right-0 mt-2 w-44 rounded-xl border border-white/10 p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="space-y-0.5">
            {RANGE_OPTIONS.map((opt) => {
              const isSelected = opt.value === selected.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectRange(opt.value)}
                  className={`flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-xs font-medium transition-colors text-left ${
                    isSelected
                      ? "text-white bg-white/[0.08]"
                      : "text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                      isSelected ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" : "bg-transparent"
                    }`}
                  />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
