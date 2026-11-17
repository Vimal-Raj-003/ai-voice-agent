import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Appt = {
  id: string;
  date: string;
  time: string;
  name: string;
  service?: string;
  status: string;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function chipColor(status: string): string {
  if (status === "CANCELLED" || status === "NO_SHOW") {
    return "bg-rose-500/15 border-rose-400/30 text-rose-200 line-through opacity-75";
  }
  if (status === "COMPLETED") {
    return "bg-emerald-500/15 border-emerald-400/30 text-emerald-200";
  }
  return "bg-teal-500/20 border-teal-400/40 text-teal-100";
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
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstWeekday = firstDow === 0 ? 7 : firstDow;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: ({ day: number; iso: string } | null)[] = [];
  for (let i = 1; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: isoDate(year, month, d) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="glass rounded-2xl p-3 sm:p-5">
      {/* Google Calendar Style Header */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">{monthLabel}</h2>
          <Link
            href="/calendar"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-gray-200 hover:bg-white/10 transition"
          >
            Today
          </Link>
        </div>

        <div className="flex items-center gap-1.5">
          <Link
            href={`/calendar?month=${shiftMonth(monthKey, -1)}`}
            className="rounded-lg border border-white/10 bg-white/5 p-2 hover:bg-white/10 transition"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </Link>
          <Link
            href={`/calendar?month=${shiftMonth(monthKey, 1)}`}
            className="rounded-lg border border-white/10 bg-white/5 p-2 hover:bg-white/10 transition"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-t border-l border-white/10 rounded-t-xl overflow-hidden bg-white/[0.02]">
        {DAY_NAMES.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-r border-b border-white/10"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Google Calendar Style Month Grid with Event Chips */}
      <div className="grid grid-cols-7 border-l border-white/10 rounded-b-xl overflow-hidden">
        {cells.map((c, i) => {
          if (!c) {
            return (
              <div
                key={i}
                className="min-h-[72px] sm:min-h-[104px] border-r border-b border-white/10 bg-black/20"
              />
            );
          }
          const apptsHere = byDate.get(c.iso) ?? [];
          const count = apptsHere.length;
          const isSelected = selected === c.iso;
          const isToday = c.iso === todayIso;

          return (
            <Link
              key={i}
              href={`/calendar?month=${monthKey}&day=${c.iso}`}
              className={`min-h-[72px] sm:min-h-[104px] p-1.5 sm:p-2 border-r border-b border-white/10 flex flex-col justify-start gap-1 text-left transition ${
                isSelected
                  ? "bg-teal-500/[0.12] ring-2 ring-inset ring-teal-400/70"
                  : count > 0
                  ? "bg-white/[0.025] hover:bg-white/[0.06]"
                  : "hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums font-semibold ${
                    isToday
                      ? "bg-teal-400 text-teal-950 font-bold shadow-sm"
                      : isSelected
                      ? "text-teal-300"
                      : "text-gray-300"
                  }`}
                >
                  {c.day}
                </span>
                {count > 0 && (
                  <span className="sm:hidden h-2 w-2 rounded-full bg-teal-400" />
                )}
              </div>

              {/* Event Chips (Desktop / Tablet) */}
              <div className="hidden sm:flex flex-col gap-1 w-full overflow-hidden">
                {apptsHere.slice(0, 2).map((ev) => (
                  <div
                    key={ev.id}
                    className={`w-full truncate rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium leading-tight ${chipColor(
                      ev.status
                    )}`}
                    title={`${ev.time} · ${ev.name}`}
                  >
                    <span className="font-mono font-semibold mr-1">{ev.time}</span>
                    <span>{ev.name}</span>
                  </div>
                ))}
                {count > 2 && (
                  <span className="text-[10px] font-semibold text-teal-300 pl-1">
                    +{count - 2} more
                  </span>
                )}
              </div>

              {/* Compact Count Pill on Phones */}
              {count > 0 && (
                <span className="sm:hidden mt-auto text-[10px] font-semibold text-teal-300 truncate">
                  {count} {count === 1 ? "event" : "events"}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
