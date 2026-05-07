import { prisma } from "@/lib/prisma";
import MonthGrid from "@/components/calendar/MonthGrid";
import DayDrawer from "@/components/calendar/DayDrawer";

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

  const appts = await prisma.appointment.findMany({
    where: { date: { gte: startStr, lte: endStr } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  const byDate = new Map<string, typeof appts>();
  for (const a of appts) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }

  const day = sp.day && byDate.has(sp.day) ? sp.day : null;
  const dayList = day ? byDate.get(day) ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Calendar</h1>
        <p className="text-sm text-gray-400 mt-1">
          All bookings made by the agent. Cal.com and Google Calendar sync via
          the agent&apos;s booking tools.
        </p>
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
