import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { PhoneCall, CalendarCheck, Bot, Megaphone } from "lucide-react";
import StatCard from "@/components/StatCard";
import ActiveCallsPanel from "@/components/ActiveCallsPanel";
import CallsTimeline from "@/components/charts/CallsTimeline";
import OutcomeDonut from "@/components/charts/OutcomeDonut";
import BookingGauge from "@/components/charts/BookingGauge";

export default async function Overview() {
  const { id: orgId } = await getDefaultOrg();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    callCount,
    bookedCount,
    assistantCount,
    activeCampaigns,
    recentCalls,
    activeCallsRaw,
  ] = await Promise.all([
    prisma.call.count({ where: { organizationId: orgId } }),
    prisma.call.count({ where: { organizationId: orgId, wasBooked: true } }),
    prisma.assistant.count({ where: { organizationId: orgId } }),
    prisma.campaign.count({
      where: { organizationId: orgId, status: "RUNNING" },
    }),
    prisma.call.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      select: { createdAt: true, outcome: true, wasBooked: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.activeCall.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
  ]);

  // Build the last-14-days timeline by binning recentCalls by ISO date.
  const timeline: { date: string; calls: number; booked: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    timeline.push({ date: d.toISOString().slice(0, 10), calls: 0, booked: 0 });
  }
  const idx = new Map(timeline.map((p, i) => [p.date, i]));
  for (const c of recentCalls) {
    const key = c.createdAt.toISOString().slice(0, 10);
    const i = idx.get(key);
    if (i !== undefined) {
      timeline[i].calls += 1;
      if (c.wasBooked) timeline[i].booked += 1;
    }
  }

  // Outcome distribution for the donut.
  const outcomeMap = new Map<string, number>();
  for (const c of recentCalls) {
    const k = c.outcome ?? "UNKNOWN";
    outcomeMap.set(k, (outcomeMap.get(k) ?? 0) + 1);
  }
  const outcomeData = [...outcomeMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const bookingRate =
    callCount > 0 ? (bookedCount / callCount) * 100 : 0;

  const activeCalls = activeCallsRaw.map((a) => ({
    roomId: a.roomId,
    phoneNumber: a.phoneNumber,
    callerName: a.callerName,
    status: a.status,
    startedAt: a.startedAt,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Overview</h1>
        <p className="text-sm text-gray-400 mt-1">
          Real-time view of the voice platform — calls, bookings, and live
          activity in the last 14 days.
        </p>
      </div>

      {/* Top stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total calls"
          value={callCount}
          icon={PhoneCall}
          tone="cyan"
        />
        <StatCard
          label="Bookings"
          value={bookedCount}
          hint={`${bookingRate.toFixed(1)}% rate`}
          icon={CalendarCheck}
          tone="emerald"
        />
        <StatCard
          label="Assistants"
          value={assistantCount}
          icon={Bot}
          tone="violet"
        />
        <StatCard
          label="Running campaigns"
          value={activeCampaigns}
          icon={Megaphone}
          tone="magenta"
        />
      </div>

      {/* Main row: timeline (wide) + active calls (narrow) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              Calls timeline
            </h2>
            <span className="text-[10px] text-gray-500 font-mono">14 days</span>
          </div>
          {recentCalls.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-gray-500">
              No calls in the last 14 days.
            </div>
          ) : (
            <CallsTimeline data={timeline} />
          )}
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-cyan-400" /> Calls
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-400" /> Booked
            </span>
          </div>
        </section>

        <ActiveCallsPanel calls={activeCalls} />
      </div>

      {/* Bottom row: outcome donut + booking-rate gauge */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-2">
            Outcome distribution
          </h2>
          {outcomeData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-gray-500">
              No outcome data yet.
            </div>
          ) : (
            <>
              <OutcomeDonut data={outcomeData} />
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {outcomeData.slice(0, 6).map((d, i) => (
                  <li
                    key={d.name}
                    className="flex items-center justify-between text-gray-400"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          background: [
                            "#34d399",
                            "#22d3ee",
                            "#a78bfa",
                            "#f59e0b",
                            "#f472b6",
                            "#ef4444",
                          ][i % 6],
                        }}
                      />
                      {d.name}
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      {d.value}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-2">
            Booking rate
          </h2>
          <BookingGauge pct={bookingRate} />
          <div className="mt-3 text-center text-xs text-gray-500">
            {bookedCount.toLocaleString()} of {callCount.toLocaleString()} calls
            converted
          </div>
        </section>
      </div>
    </div>
  );
}
