import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import {
  PhoneCall,
  CalendarCheck,
  Bot,
  Megaphone,
  CircleDollarSign,
  Coins,
} from "lucide-react";
import StatCard from "@/components/StatCard";
import ActiveCallsPanel from "@/components/ActiveCallsPanel";
import CallsTimeline from "@/components/charts/CallsTimeline";
import OutcomeDonut from "@/components/charts/OutcomeDonut";
import BookingGauge from "@/components/charts/BookingGauge";
import TokensTimeline from "@/components/charts/TokensTimeline";
import CostStackedBar from "@/components/charts/CostStackedBar";
import { aggregateCalls, buildRateMap, computeCallCost } from "@/lib/cost";

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
    rates,
    costCalls,
  ] = await Promise.all([
    prisma.call.count({ where: { organizationId: orgId } }),
    prisma.call.count({ where: { organizationId: orgId, wasBooked: true } }),
    prisma.assistant.count({ where: { organizationId: orgId } }),
    prisma.campaign.count({
      where: { organizationId: orgId, status: "RUNNING" },
    }),
    prisma.call.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      select: {
        createdAt: true,
        outcome: true,
        wasBooked: true,
        llmInputTokens: true,
        llmOutputTokens: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.activeCall.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.providerRate.findMany(),
    // Pull every column the cost lib needs for the spend infograph.
    prisma.call.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        direction: true,
        durationSeconds: true,
        llmInputTokens: true,
        llmOutputTokens: true,
        llmProviderUsed: true,
        llmSkuUsed: true,
        sttSeconds: true,
        sttProviderUsed: true,
        sttSkuUsed: true,
        ttsChars: true,
        ttsProviderUsed: true,
        ttsSkuUsed: true,
        telephonyProvider: true,
      },
    }),
  ]);

  // Build the last-14-days timelines by binning recentCalls by ISO date.
  // Same shape used by both the calls chart and the tokens chart.
  const timeline: { date: string; calls: number; booked: number }[] = [];
  const tokenTimeline: { date: string; input: number; output: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    timeline.push({ date: key, calls: 0, booked: 0 });
    tokenTimeline.push({ date: key, input: 0, output: 0 });
  }
  const idx = new Map(timeline.map((p, i) => [p.date, i]));
  for (const c of recentCalls) {
    const key = c.createdAt.toISOString().slice(0, 10);
    const i = idx.get(key);
    if (i !== undefined) {
      timeline[i].calls += 1;
      if (c.wasBooked) timeline[i].booked += 1;
      tokenTimeline[i].input += c.llmInputTokens ?? 0;
      tokenTimeline[i].output += c.llmOutputTokens ?? 0;
    }
  }
  const totalInputTokens = tokenTimeline.reduce((s, p) => s + p.input, 0);
  const totalOutputTokens = tokenTimeline.reduce((s, p) => s + p.output, 0);

  // Cost aggregation for the spend infograph + tile.
  const rateMap = buildRateMap(rates);
  const costAgg = aggregateCalls(costCalls, rateMap, 14);
  const activeCostProviders = costAgg.byProvider
    .filter((p) => p.costUsd > 0)
    .map((p) => p.provider);
  // Today-only spend for the spotlight tile.
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysCalls = costCalls.filter(
    (c) => c.createdAt.toISOString().slice(0, 10) === todayKey,
  );
  const todaysSpend = todaysCalls.reduce(
    (s, c) => s + computeCallCost(c, rateMap).totalUsd,
    0,
  );

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

      {/* Top stat tiles — calls + bookings + spend + tokens */}
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
          label="Spend (14d)"
          value={`$${costAgg.totalUsd.toFixed(2)}`}
          hint={`Today $${todaysSpend.toFixed(4)}`}
          icon={CircleDollarSign}
          tone="violet"
        />
        <StatCard
          label="Tokens (14d)"
          value={
            totalInputTokens + totalOutputTokens > 1_000_000
              ? `${((totalInputTokens + totalOutputTokens) / 1_000_000).toFixed(2)}M`
              : `${Math.round((totalInputTokens + totalOutputTokens) / 1000)}K`
          }
          hint={`${(totalInputTokens / 1000).toFixed(0)}K in · ${(totalOutputTokens / 1000).toFixed(0)}K out`}
          icon={Coins}
          tone="magenta"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
        <StatCard
          label="Assistants"
          value={assistantCount}
          icon={Bot}
          tone="cyan"
        />
        <StatCard
          label="Running campaigns"
          value={activeCampaigns}
          icon={Megaphone}
          tone="emerald"
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

      {/* Token + spend infographs row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              Token usage
            </h2>
            <span className="text-[10px] text-gray-500 font-mono">14 days</span>
          </div>
          {totalInputTokens + totalOutputTokens === 0 ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center">
              <Coins size={28} className="text-gray-600 mb-2" />
              <div className="text-sm text-gray-500">No token usage yet.</div>
              <div className="text-[11px] text-gray-600 mt-1">
                Once a call completes, LLM tokens land here.
              </div>
            </div>
          ) : (
            <TokensTimeline data={tokenTimeline} />
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              Spend by provider
            </h2>
            <span className="text-[10px] text-gray-500 font-mono">14 days</span>
          </div>
          {costAgg.totalUsd === 0 ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center">
              <CircleDollarSign size={28} className="text-gray-600 mb-2" />
              <div className="text-sm text-gray-500">No spend yet.</div>
              <div className="text-[11px] text-gray-600 mt-1">
                See the full breakdown on /costs once calls happen.
              </div>
            </div>
          ) : (
            <CostStackedBar
              data={costAgg.byDay}
              providers={activeCostProviders}
            />
          )}
        </section>
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
