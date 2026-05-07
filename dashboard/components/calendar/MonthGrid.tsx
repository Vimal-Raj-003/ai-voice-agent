import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Appt = {
  id: string;
  date: string;
  time: string;
  name: string;
  status: string;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

export default function MonthGrid({
  year,
  month,
  byDate,
  selected,
  monthKey,
}: {
  year: number;
  month: number;
  byDate: Map<string, Appt[]>;
  selected: string | null;
  monthKey: string;
}) {
  // Monday-based weekday: convert getUTCDay (Sun=0..Sat=6) → Mon=1..Sun=7
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstWeekday = firstDow === 0 ? 7 : firstDow;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: ({ day: number; iso: string } | null)[] = [];
  for (let i = 1; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, iso: isoDate(year, month, d) });
  // pad to a multiple of 7 so the grid bottom is even
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <Link
            href={`/calendar?month=${shiftMonth(monthKey, -1)}`}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </Link>
          <Link
            href="/calendar"
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
          >
            Today
          </Link>
          <Link
            href={`/calendar?month=${shiftMonth(monthKey, 1)}`}
            className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10"
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-widest text-gray-500 mb-2">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />;
          const apptsHere = byDate.get(c.iso) ?? [];
          const count = apptsHere.length;
          const isSelected = selected === c.iso;
          const isToday = c.iso === todayIso;
          return (
            <Link
              key={i}
              href={`/calendar?month=${monthKey}&day=${c.iso}`}
              className={`aspect-square rounded-lg border p-1.5 flex flex-col items-start justify-between text-xs transition ${
                isSelected
                  ? "border-cyan-400/60 bg-cyan-500/10 ring-2 ring-cyan-400/40"
                  : count > 0
                  ? "border-violet-400/30 bg-violet-500/[0.06] hover:bg-violet-500/10"
                  : isToday
                  ? "border-white/20 bg-white/[0.04] hover:bg-white/[0.06]"
                  : "border-white/5 hover:bg-white/[0.03]"
              }`}
            >
              <span
                className={`tabular-nums ${
                  isSelected
                    ? "font-semibold text-cyan-200"
                    : isToday
                    ? "font-semibold text-white"
                    : "text-gray-300"
                }`}
              >
                {c.day}
              </span>
              {count > 0 && (
                <span className="text-[10px] font-mono text-violet-200">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-violet-400/60 ring-1 ring-violet-300/40" />
          has bookings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-cyan-400/60 ring-1 ring-cyan-300/40" />
          selected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-white/15" />
          today
        </span>
      </div>
    </div>
  );
}
