import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { buildRateMap, aggregateCalls, computeCallCost } from "@/lib/cost";
import { getUsdInrRate } from "@/lib/currency";
import CostsView, { type CallCostRow } from "@/components/CostsView";
import RatesPanel from "@/components/RatesPanel";
import { AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const { id: orgId } = await getDefaultOrg();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [rates, calls, fx] = await Promise.all([
    prisma.providerRate.findMany({ orderBy: [{ provider: "asc" }, { kind: "asc" }] }),
    prisma.call.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        direction: true,
        durationSeconds: true,
        // For the per-call table + breakdown.
        toNumber: true,
        fromNumber: true,
        status: true,
        recordingDurationSeconds: true,
        // The assistant's CONFIGURED model — compared against the model that
        // actually ran so a fallback turn can be labelled as such.
        assistant: { select: { llmModel: true } },
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
    getUsdInrRate(),
  ]);

  const rateMap = buildRateMap(rates);
  const agg = aggregateCalls(calls, rateMap, 14);

  const totalCalls = calls.length;
  const avgPerCall = totalCalls > 0 ? agg.totalUsd / totalCalls : 0;
  const totalMinutes = calls.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) / 60;

  // Per-call rows for the "Cost by call" table. `includeUnavailable` makes
  // usage with no rate visible as "Rate unavailable" instead of vanishing —
  // those lines carry cost 0, so totals are unaffected.
  const callRows: CallCostRow[] = calls.map((c) => {
    const b = computeCallCost(c, rateMap, {
      includeUnavailable: true,
      configuredLlmModel: c.assistant?.llmModel ?? null,
    });
    return {
      id: c.id,
      // The counterparty: who we called, or who called us.
      phone: c.direction === "INBOUND" ? c.fromNumber : c.toNumber,
      direction: c.direction,
      status: c.status,
      createdAtIso: c.createdAt.toISOString(),
      durationSeconds: c.durationSeconds,
      totalUsd: b.totalUsd,
      hasUnknownRates: b.hasUnknownRates,
      lines: b.lines,
    };
  });

  // Today / month totals are summed from the SAME per-call costs as the table,
  // so the headline figures can never disagree with the rows beneath them.
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  let todayUsd = 0;
  let monthUsd = 0;
  for (const r of callRows) {
    const t = new Date(r.createdAtIso);
    if (t >= startOfToday) todayUsd += r.totalUsd;
    if (t >= startOfMonth) monthUsd += r.totalUsd;
  }

  // Only providers with real spend make the chart legend.
  const spendingProviders = agg.byProvider.filter((p) => p.costUsd > 0);
  const activeProviders = spendingProviders.map((p) => p.provider);

  const RATES_CRON_INTERVAL_MIN = 180; // matches cron */3 hours
  const RATES_STALE_SLACK_MIN = 20; // allow a run to take its time
  const RATES_STALE_THRESHOLD_MIN = RATES_CRON_INTERVAL_MIN + RATES_STALE_SLACK_MIN;

  const lastVerified = rates.reduce<Date | null>((acc, r) => {
    const d = r.lastVerifiedAt;
    return acc && acc > d ? acc : d;
  }, null);
  const ageMinutes = lastVerified
    ? Math.floor((Date.now() - new Date(lastVerified).getTime()) / 60000)
    : null;

  return (
    <div className="space-y-8">
      <CostsView
        fx={fx}
        totalUsd={agg.totalUsd}
        totalCalls={totalCalls}
        avgPerCallUsd={avgPerCall}
        totalMinutes={totalMinutes}
        todayUsd={todayUsd}
        monthUsd={monthUsd}
        byDay={agg.byDay}
        byProvider={spendingProviders}
        activeProviders={activeProviders}
        calls={callRows}
      />

      {/* Prisma's Decimal is not serialisable across the server→client
          boundary, so flatten rateUsd to a string before passing. */}
      <RatesPanel rates={rates.map((r) => ({ ...r, rateUsd: r.rateUsd.toString() }))} />

      {ageMinutes != null && ageMinutes > RATES_STALE_THRESHOLD_MIN && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-xs text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
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
