"use client";

// View switch + search + filters for the calendar. Drives URL params only, so
// the page stays a server component and the existing month/day query logic is
// reused rather than duplicated client-side.
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, CalendarRange, Search, X } from "lucide-react";

const VIEWS = [
  { id: "month", label: "Month", icon: CalendarDays },
  { id: "week", label: "Week", icon: CalendarRange },
  { id: "day", label: "Day", icon: CalendarRange },
] as const;

const STATUSES = ["BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"];

const control =
  "rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/40";

export default function CalendarToolbar({
  view,
  services,
  hosts,
}: {
  view: string;
  services: string[];
  hosts: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  const q = sp.get("q") ?? "";
  const status = sp.get("status") ?? "";
  const service = sp.get("service") ?? "";
  const host = sp.get("host") ?? "";
  const filtered = !!(q || status || service || host);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Calendar view" className="flex gap-1">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => set({ view: id })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
              view === id
                ? "border-violet-400/40 bg-violet-500/[0.14] text-violet-100"
                : "border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.08] hover:text-white"
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          defaultValue={q}
          onKeyDown={(e) => {
            if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value });
          }}
          onBlur={(e) => { if (e.target.value !== q) set({ q: e.target.value }); }}
          placeholder="Search name, phone, email…"
          aria-label="Search bookings"
          className={control + " w-52 pl-7"}
        />
      </div>

      <select
        value={status}
        onChange={(e) => set({ status: e.target.value })}
        aria-label="Filter by status"
        className={control}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <select
        value={service}
        onChange={(e) => set({ service: e.target.value })}
        aria-label="Filter by service"
        className={control}
      >
        <option value="">All services</option>
        {services.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      {hosts.length > 0 && (
        <select
          value={host}
          onChange={(e) => set({ host: e.target.value })}
          aria-label="Filter by host"
          className={control}
        >
          <option value="">All hosts</option>
          {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      )}

      {filtered && (
        <button
          type="button"
          onClick={() => set({ q: null, status: null, service: null, host: null })}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-gray-400 transition hover:bg-white/[0.08] hover:text-white"
        >
          <X size={11} /> Clear
        </button>
      )}
      {pending && <span className="text-[10px] text-gray-500">updating…</span>}
    </div>
  );
}
