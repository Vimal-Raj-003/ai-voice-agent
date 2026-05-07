// Cost computation. The whole point: cost = usage × current rate, computed
// at query time from the ProviderRate table — never stored on the Call.
// When OpenAI cuts gpt-4o-mini prices tomorrow, every historical row's
// reported cost moves with the rate.

import type {
  Call,
  CallDirection,
  ProviderRate,
  RateKind,
} from "@prisma/client";

export type CostLine = {
  label: string;       // "OpenAI gpt-4o-mini input"
  provider: string;
  sku: string;
  kind: RateKind;
  units: number;       // how many tokens / minutes / chars / 1k-chars
  unitLabel: string;   // "Mtok", "min", "kchars"
  rateUsd: number;     // current rate per unit
  costUsd: number;     // units × rateUsd
};

export type CostBreakdown = {
  totalUsd: number;
  lines: CostLine[];
  hasUnknownRates: boolean; // true if any usage column is set but no matching rate row
};

// Fast lookup: { "provider|sku|kind": numeric rate }
export function buildRateMap(
  rates: Pick<ProviderRate, "provider" | "sku" | "kind" | "rateUsd">[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rates) {
    const key = `${r.provider}|${r.sku}|${r.kind}`;
    m.set(key, Number(r.rateUsd));
  }
  return m;
}

function lookup(
  map: Map<string, number>,
  provider: string | null | undefined,
  sku: string | null | undefined,
  kind: RateKind,
): number | null {
  if (!provider || !sku) return null;
  const v = map.get(`${provider}|${sku}|${kind}`);
  return v == null ? null : v;
}

const SECONDS_PER_MINUTE = 60;

// Compute cost lines for a single call against the live rate map. Lines are
// only added when the corresponding usage column is non-null AND a matching
// rate row exists. Missing rates get flagged via hasUnknownRates so the UI
// can warn — better than silently underreporting.
export type CallCostInput = Pick<
  Call,
  | "direction"
  | "llmInputTokens"
  | "llmOutputTokens"
  | "llmProviderUsed"
  | "llmSkuUsed"
  | "sttSeconds"
  | "sttProviderUsed"
  | "sttSkuUsed"
  | "ttsChars"
  | "ttsProviderUsed"
  | "ttsSkuUsed"
  | "telephonyProvider"
  | "durationSeconds"
>;

export function computeCallCost(
  call: CallCostInput,
  rateMap: Map<string, number>,
): CostBreakdown {
  const lines: CostLine[] = [];
  let unknown = false;

  // — LLM input —
  if (call.llmInputTokens && call.llmInputTokens > 0) {
    const r = lookup(rateMap, call.llmProviderUsed, call.llmSkuUsed, "LLM_INPUT_MTOK");
    if (r == null) unknown = true;
    else {
      const mtok = call.llmInputTokens / 1_000_000;
      lines.push({
        label: `${call.llmProviderUsed} ${call.llmSkuUsed} input`,
        provider: call.llmProviderUsed!,
        sku: call.llmSkuUsed!,
        kind: "LLM_INPUT_MTOK",
        units: mtok,
        unitLabel: "Mtok",
        rateUsd: r,
        costUsd: mtok * r,
      });
    }
  }
  // — LLM output —
  if (call.llmOutputTokens && call.llmOutputTokens > 0) {
    const r = lookup(rateMap, call.llmProviderUsed, call.llmSkuUsed, "LLM_OUTPUT_MTOK");
    if (r == null) unknown = true;
    else {
      const mtok = call.llmOutputTokens / 1_000_000;
      lines.push({
        label: `${call.llmProviderUsed} ${call.llmSkuUsed} output`,
        provider: call.llmProviderUsed!,
        sku: call.llmSkuUsed!,
        kind: "LLM_OUTPUT_MTOK",
        units: mtok,
        unitLabel: "Mtok",
        rateUsd: r,
        costUsd: mtok * r,
      });
    }
  }
  // — STT —
  if (call.sttSeconds && call.sttSeconds > 0) {
    const r = lookup(rateMap, call.sttProviderUsed, call.sttSkuUsed, "STT_MINUTE");
    if (r == null) unknown = true;
    else {
      const min = call.sttSeconds / SECONDS_PER_MINUTE;
      lines.push({
        label: `${call.sttProviderUsed} ${call.sttSkuUsed} STT`,
        provider: call.sttProviderUsed!,
        sku: call.sttSkuUsed!,
        kind: "STT_MINUTE",
        units: min,
        unitLabel: "min",
        rateUsd: r,
        costUsd: min * r,
      });
    }
  }
  // — TTS —
  if (call.ttsChars && call.ttsChars > 0) {
    const r = lookup(rateMap, call.ttsProviderUsed, call.ttsSkuUsed, "TTS_KCHARS");
    if (r == null) unknown = true;
    else {
      const kchars = call.ttsChars / 1000;
      lines.push({
        label: `${call.ttsProviderUsed} ${call.ttsSkuUsed} TTS`,
        provider: call.ttsProviderUsed!,
        sku: call.ttsSkuUsed!,
        kind: "TTS_KCHARS",
        units: kchars,
        unitLabel: "kchars",
        rateUsd: r,
        costUsd: kchars * r,
      });
    }
  }
  // — Telephony — pick the right SKU based on call direction so inbound
  // calls aren't billed at the outbound rate. Inbound is typically zero
  // (rolled into trunk rental) but it's still a real lookup.
  if (call.telephonyProvider && call.durationSeconds && call.durationSeconds > 0) {
    const sku = call.direction === "INBOUND" ? "inbound" : "outbound";
    const r = lookup(rateMap, call.telephonyProvider, sku, "TELEPHONY_MINUTE");
    if (r == null) unknown = true;
    else {
      const min = call.durationSeconds / SECONDS_PER_MINUTE;
      if (r > 0) {
        lines.push({
          label: `${call.telephonyProvider} ${sku} telephony`,
          provider: call.telephonyProvider,
          sku,
          kind: "TELEPHONY_MINUTE",
          units: min,
          unitLabel: "min",
          rateUsd: r,
          costUsd: min * r,
        });
      }
    }
  }

  const totalUsd = lines.reduce((s, l) => s + l.costUsd, 0);
  return { totalUsd, lines, hasUnknownRates: unknown };
}

// Aggregate many calls — used by the cost dashboard. Returns total + a
// per-day stacked structure plus a per-provider total.
export type CostAggregate = {
  totalUsd: number;
  byDay: Array<{ date: string } & Record<string, number>>;
  byProvider: Array<{ provider: string; costUsd: number }>;
  perCall: Array<{ id: string; costUsd: number; createdAt: Date }>;
};

export function aggregateCalls(
  calls: Array<{ id: string; createdAt: Date } & CallCostInput>,
  rateMap: Map<string, number>,
  daysBack = 14,
): CostAggregate {
  const today = new Date();
  const dayKeys: string[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const providerTotals = new Map<string, number>();
  const dayProviderTotals = new Map<string, Map<string, number>>();
  for (const k of dayKeys) dayProviderTotals.set(k, new Map());

  let totalUsd = 0;
  const perCall: CostAggregate["perCall"] = [];

  for (const c of calls) {
    const { totalUsd: callTotal, lines } = computeCallCost(c, rateMap);
    totalUsd += callTotal;
    perCall.push({ id: c.id, costUsd: callTotal, createdAt: c.createdAt });
    const dayKey = new Date(c.createdAt).toISOString().slice(0, 10);
    const dayMap = dayProviderTotals.get(dayKey);
    for (const line of lines) {
      providerTotals.set(
        line.provider,
        (providerTotals.get(line.provider) ?? 0) + line.costUsd,
      );
      if (dayMap) {
        dayMap.set(
          line.provider,
          (dayMap.get(line.provider) ?? 0) + line.costUsd,
        );
      }
    }
  }

  const byDay = dayKeys.map((date) => {
    // Recharts expects { [series]: number } rows; the chart's dataKey="date"
    // reads the date string off this same object, so we widen the typing
    // here rather than at the recharts layer.
    const row = { date } as { date: string } & Record<string, number>;
    const m = dayProviderTotals.get(date);
    if (m) for (const [p, v] of m) row[p] = Number(v.toFixed(6));
    return row;
  });
  const byProvider = [...providerTotals.entries()]
    .map(([provider, costUsd]) => ({ provider, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return { totalUsd, byDay, byProvider, perCall };
}
