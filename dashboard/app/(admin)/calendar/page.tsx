import { prisma } from "@/lib/prisma";
import { CalendarCheck, CheckCircle2, XCircle, Clock } from "lucide-react";
import MonthGrid from "@/components/calendar/MonthGrid";
import DayDrawer from "@/components/calendar/DayDrawer";
import BookingForm from "@/components/calendar/BookingForm";
import StatCard from "@/components/StatCard";

type Search = { month?: string; day?: string };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const today = new Date();
  // ?month=YYYY-MM, default to current
  const monthKey =
    sp.month ||
    `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1-12

  const startStr = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endStr = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  const [appts, totalThisMonth, completed, cancelled, upcoming] =
    await Promise.all([
      prisma.appointment.findMany({
        where: { date: { gte: startStr, lte: endStr } },
        orderBy: [{ date: "asc" }, { time: "asc" }],
      }),
      prisma.appointment.count({
        where: { date: { gte: startStr, lte: endStr } },
      }),
      prisma.appointment.count({
        where: { date: { gte: startStr, lte: endStr }, status: "COMPLETED" },
      }),
      prisma.appointment.count({
        where: { date: { gte: startStr, lte: endStr }, status: "CANCELLED" },
      }),
      prisma.appointment.count({
        where: {
          date: { gte: today.toISOString().slice(0, 10) },
          status: "BOOKED",
        },
      }),
    ]);

  const byDate = new Map<string, typeof appts>();
  for (const a of appts) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }

  const day = sp.day && byDate.has(sp.day) ? sp.day : null;
  const dayList = day ? byDate.get(day) ?? [] : [];

  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Calendar</h1>
          <p className="text-sm text-gray-400 mt-1">
            All bookings — agent-created via Cal.com / Google Calendar tools
            and manual entries below.
          </p>
        </div>
        <BookingForm defaultDate={day ?? today.toISOString().slice(0, 10)} />
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
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
    </div>
  );
}
