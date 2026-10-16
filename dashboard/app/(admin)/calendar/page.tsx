import { prisma } from "@/lib/prisma";
import { CalendarCheck, CheckCircle2, XCircle, Clock, Info } from "lucide-react";
import MonthGrid from "@/components/calendar/MonthGrid";
import DayDrawer from "@/components/calendar/DayDrawer";
import BookingForm from "@/components/calendar/BookingForm";
import CalendarAutoRefresh from "@/components/calendar/CalendarAutoRefresh";
import CalendarToolbar from "@/components/calendar/CalendarToolbar";
import StatCard from "@/components/StatCard";
import { calcomStatus } from "@/lib/calcom";

type Search = {
  month?: string; day?: string; view?: string;
  q?: string; status?: string; service?: string; host?: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const today = new Date();
  const view = sp.view === "week" || sp.view === "day" ? sp.view : "month";

  // ?month=YYYY-MM, default to current
  const monthKey =
    sp.month ||
    `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1-12

  const monthStart = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  // The selected day anchors the day and week views.
  const anchor = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : iso(today);

  // Range actually listed, by view. Month stays exactly as before.
  let rangeStart = monthStart;
  let rangeEnd = monthEnd;
  if (view === "day") {
    rangeStart = rangeEnd = anchor;
  } else if (view === "week") {
    const a = new Date(anchor + "T00:00:00Z");
    const dow = a.getUTCDay(); // 0=Sun
    const monday = new Date(a);
    monday.setUTCDate(a.getUTCDate() - ((dow + 6) % 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    rangeStart = iso(monday);
    rangeEnd = iso(sunday);
  }

  // Search / filter. Applied to the listing only — the stat tiles stay
  // month-scoped and unfiltered, as they were.
  const q = (sp.q ?? "").trim();
  const statusFilter = ["BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"]
    .find((s) => s === sp.status);
  const listWhere = {
    date: { gte: rangeStart, lte: rangeEnd },
    ...(statusFilter ? { status: statusFilter as "BOOKED" } : {}),
    ...(sp.service ? { service: sp.service } : {}),
    ...(sp.host ? { host: sp.host } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { phoneNumber: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
            { bookingId: { contains: q.toUpperCase() } },
          ],
        }
      : {}),
  };

  const [appts, totalThisMonth, completed, cancelled, upcoming, services, hostRows] =
    await Promise.all([
      prisma.appointment.findMany({
        where: listWhere,
        orderBy: [{ date: "asc" }, { time: "asc" }],
      }),
      prisma.appointment.count({ where: { date: { gte: monthStart, lte: monthEnd } } }),
      prisma.appointment.count({
        where: { date: { gte: monthStart, lte: monthEnd }, status: "COMPLETED" },
      }),
      prisma.appointment.count({
        where: { date: { gte: monthStart, lte: monthEnd }, status: "CANCELLED" },
      }),
      prisma.appointment.count({
        where: { date: { gte: iso(today) }, status: "BOOKED" },
      }),
      prisma.appointment.findMany({
        distinct: ["service"], select: { service: true }, orderBy: { service: "asc" },
      }),
      prisma.appointment.findMany({
        where: { host: { not: null } },
        distinct: ["host"], select: { host: true }, orderBy: { host: "asc" },
      }),
    ]);

  const byDate = new Map<string, typeof appts>();
  for (const a of appts) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }

  // Month view keeps its existing behaviour: a day is selected only when it
  // actually has bookings. Day/week views always show their range.
  const day = sp.day && byDate.has(sp.day) ? sp.day : null;
  const dayList = day ? byDate.get(day) ?? [] : [];

  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  const serviceNames = services.map((s) => s.service).filter(Boolean);
  const hostNames = hostRows.map((h) => h.host!).filter(Boolean);

  // External sync status — stated plainly rather than implied.
  const calOn = (await calcomStatus()).configured;
  const gcalOn = !!(process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_SERVICE_ACCOUNT_FILE);

  const rangeLabel =
    view === "month"
      ? monthLabel
      : view === "day"
        ? new Date(anchor + "T00:00:00Z").toLocaleDateString("en-US", {
            weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
        : `${rangeStart} → ${rangeEnd}`;

  return (
    <div className="space-y-6">
      <CalendarAutoRefresh />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Calendar</h1>
          <p className="text-sm text-gray-400 mt-1">
            All bookings — created by the voice agent and manually below.
          </p>
        </div>
        <BookingForm defaultDate={day ?? anchor} hosts={hostNames} />
      </div>

      {/* Synchronisation status. Neon is the source of truth; this says
          whether anything is mirrored outward. */}
      <p className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-gray-400">
        <Info size={12} className="shrink-0 text-gray-500" />
        <span>
          Bookings are stored in this dashboard.
        </span>
        <span className={calOn ? "text-emerald-300" : "text-gray-500"}>
          Cal.com {calOn ? "connected" : "not configured"}
        </span>
        <span className="text-gray-700">·</span>
        <span className={gcalOn ? "text-emerald-300" : "text-gray-500"}>
          Google Calendar {gcalOn ? "connected" : "not configured"}
        </span>
        {!calOn && !gcalOn && (
          <span className="text-gray-500">
            — external calendar sync is not active, so bookings here are local only.
          </span>
        )}
      </p>

      {/* Month-scoped stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={`Bookings · ${monthLabel}`}
          value={totalThisMonth}
          icon={CalendarCheck}
          tone="cyan"
        />
        <StatCard
          label="Completed"
          value={completed}
          hint={
            totalThisMonth > 0
              ? `${((completed / totalThisMonth) * 100).toFixed(0)}% of month`
              : "—"
          }
          icon={CheckCircle2}
          tone="emerald"
        />
        <StatCard
          label="Cancelled"
          value={cancelled}
          icon={XCircle}
          tone="magenta"
        />
        <StatCard
          label="Upcoming (all time)"
          value={upcoming}
          icon={Clock}
          tone="violet"
        />
      </div>

      <CalendarToolbar view={view} services={serviceNames} hosts={hostNames} />

      {view === "month" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 min-w-0">
            <MonthGrid
              year={y}
              month={m}
              byDate={byDate}
              selected={day}
              monthKey={monthKey}
            />
          </div>
          <DayDrawer day={day} appts={dayList} />
        </div>
      ) : (
        // Day / week: an agenda for the range, grouped by date.
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            {rangeLabel}
            <span className="ml-2 text-[11px] font-normal tracking-normal text-gray-500">
              {appts.length} booking{appts.length === 1 ? "" : "s"}
            </span>
          </h2>
          {appts.length === 0 ? (
            <p className="glass rounded-2xl p-6 text-center text-sm text-gray-500">
              No bookings in this {view}.
            </p>
          ) : (
            [...byDate.entries()].map(([d, list]) => (
              <DayDrawer key={d} day={d} appts={list} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
