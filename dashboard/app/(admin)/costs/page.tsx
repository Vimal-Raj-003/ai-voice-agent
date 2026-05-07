import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import {
  buildRateMap,
  aggregateCalls,
} from "@/lib/cost";
import StatCard from "@/components/StatCard";
import CostStackedBar from "@/components/charts/CostStackedBar";
import CostByProvider from "@/components/charts/CostByProvider";
import RatesPanel from "@/components/RatesPanel";
import { CircleDollarSign, Phone, Clock, Coins, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const { id: orgId } = await getDefaultOrg();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [rates, calls] = await Promise.all([
    prisma.providerRate.findMany({ orderBy: [{ provider: "asc" }, { kind: "asc" }] }),
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

  const rateMap = buildRateMap(rates);
  const agg = aggregateCalls(calls, rateMap, 14);

  const totalCalls = calls.length;
  const avgPerCall = totalCalls > 0 ? agg.totalUsd / totalCalls : 0;
  const totalMinutes =
    calls.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) / 60;

  // For the stacked bar's series list — only providers with non-zero spend
  // make the chart legend; otherwise we'd render dozens of zeroed columns.
  const activeProviders = agg.byProvider
    .filter((p) => p.costUsd > 0)
    .map((p) => p.provider);

  // Find the freshest "last verified" — surface as a footer so the user can
  // see how stale the rates are. Threshold = cron interval + slack.
  const RATES_CRON_INTERVAL_MIN = 180; // matches cron */3 hours
  const RATES_STALE_SLACK_MIN = 20; // allow a run to take its time
  const RATES_STALE_THRESHOLD_MIN =
    RATES_CRON_INTERVAL_MIN + RATES_STALE_SLACK_MIN;

  const lastVerified = rates.reduce<Date | null>((acc, r) => {
    const d = r.lastVerifiedAt;
    return acc && acc > d ? acc : d;
  }, null);
  const ageMinutes = lastVerified
    ? Math.floor((Date.now() - new Date(lastVerified).getTime()) / 60000)
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Costs</h1>
        <p className="text-sm text-gray-400 mt-1">
          Per-call spend computed live from{" "}
          <span className="text-gray-300">usage × current ProviderRate</span>.
          Rates auto-refresh every 3 hours from OpenRouter; STT/TTS/telephony
          rates are admin-managed.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="14-day total"
          value={`$${agg.totalUsd.toFixed(2)}`}
          icon={CircleDollarSign}
          tone="cyan"
        />
        <StatCard
          label="Calls"
          value={totalCalls}
          icon={Phone}
          tone="violet"
        />
        <StatCard
          label="Avg / call"
          value={`$${avgPerCall.toFixed(4)}`}
          icon={Coins}
          tone="emerald"
        />
        <StatCard
          label="Minutes used"
          value={totalMinutes.toFixed(1)}
          icon={Clock}
          tone="magenta"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              Daily spend by provider
            </h2>
            <span className="text-[10px] text-gray-500 font-mono">14 days</span>
          </div>
          {totalCalls === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-sm text-gray-500">
              No calls in the last 14 days yet — once a call completes, the
              cost lands here.
            </div>
          ) : (
            <CostStackedBar data={agg.byDay} providers={activeProviders} />
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-2">
            By provider
          </h2>
          {agg.byProvider.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-gray-500">
              No spend yet.
            </div>
          ) : (
            <>
              <CostByProvider data={agg.byProvider.filter((p) => p.costUsd > 0)} />
              <ul className="mt-3 space-y-1 text-[11px]">
                {agg.byProvider
                  .filter((p) => p.costUsd > 0)
                  .map((p) => (
                    <li
                      key={p.provider}
                      className="flex items-center justify-between text-gray-400"
                    >
                      <span className="capitalize">{p.provider}</span>
                      <span className="font-mono tabular-nums text-gray-300">
                        ${p.costUsd.toFixed(4)}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <RatesPanel rates={rates} />

      {ageMinutes != null && ageMinutes > RATES_STALE_THRESHOLD_MIN && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-200">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Rates were last refreshed {Math.floor(ageMinutes / 60)} hr{" "}
            {ageMinutes % 60} min ago — older than the 3-hour auto-refresh
            cadence. Check whether the voice-service scheduler is running.
          </span>
        </div>
      )}
    </div>
  );
}
