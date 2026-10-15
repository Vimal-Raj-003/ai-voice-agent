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

/** Pipeline stage a cost line belongs to, for the per-call breakdown. */
export type CostCategory =
  | "TELEPHONY" | "MEDIA" | "STT" | "LLM" | "TTS" | "RECORDING";

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  TELEPHONY: "Vobiz / Telephony",
  MEDIA: "LiveKit",
  STT: "Speech-to-text",
  LLM: "LLM",
  TTS: "Text-to-speech",
  RECORDING: "Recording / Storage",
};

export type CostLine = {
  label: string;       // "OpenAI gpt-4o-mini input"
  provider: string;
  sku: string;
  kind: RateKind | null;  // null = usage exists but nothing meters it yet
  category: CostCategory;
  units: number;       // how many tokens / minutes / chars / 1k-chars
  unitLabel: string;   // "Mtok", "min", "kchars"
  rateUsd: number | null; // null = no rate row -> "Rate unavailable"
  costUsd: number;     // units × rateUsd (0 when the rate is unknown)
  /** True when usage is real but no rate exists, so cost CANNOT be computed. */
  unavailable?: boolean;
  /** True when this LLM line was served by a fallback, not the configured model. */
  fallback?: boolean;
};

export type CostBreakdown = {
  totalUsd: number;
  lines: CostLine[];
  hasUnknownRates: boolean; // true if any usage column is set but no matching rate row
};

/**
 * Opt-in extras for the Costs page. Defaults keep every existing caller
 * (Calls detail, Overview) byte-for-byte identical.
 */
export type CostOptions = {
  /**
   * Emit lines for usage that has NO rate row, marked `unavailable`, instead of
   * silently dropping them. They carry costUsd 0, so totals never change.
   */
  includeUnavailable?: boolean;
  /**
   * The assistant's CONFIGURED primary model. When the billed LLM sku differs,
   * the LLM line is flagged as served by a fallback.
   */
  configuredLlmModel?: string | null;
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
  opts: CostOptions = {},
): CostBreakdown {
  const lines: CostLine[] = [];
  let unknown = false;

  // One place that decides: priced line, or an explicit "Rate unavailable"
  // line. Cost is NEVER invented — a missing rate yields costUsd 0 and the
  // `unavailable` flag so the UI can say so.
  const add = (
    category: CostCategory,
    provider: string | null | undefined,
    sku: string | null | undefined,
    kind: RateKind | null,
    units: number,
    unitLabel: string,
    label: string,
    extra: Partial<CostLine> = {},
  ) => {
    const rate = kind ? lookup(rateMap, provider, sku, kind) : null;
    if (rate == null) {
      unknown = true;
      if (!opts.includeUnavailable) return;
      lines.push({
        label, provider: provider || "—", sku: sku || "—", kind, category,
        units, unitLabel, rateUsd: null, costUsd: 0, unavailable: true, ...extra,
      });
      return;
    }
    lines.push({
      label, provider: provider!, sku: sku!, kind, category,
      units, unitLabel, rateUsd: rate, costUsd: units * rate, ...extra,
    });
  };

  // The billed LLM model differing from the assistant's CONFIGURED model means
  // a fallback served the call (the worker records the provider/model that
  // actually ran — never inferred from the model name).
  const fellBack = Boolean(
    opts.configuredLlmModel && call.llmSkuUsed &&
    opts.configuredLlmModel !== call.llmSkuUsed,
  );

  // — LLM input —
  if (call.llmInputTokens && call.llmInputTokens > 0) {
    add("LLM", call.llmProviderUsed, call.llmSkuUsed, "LLM_INPUT_MTOK",
        call.llmInputTokens / 1_000_000, "Mtok",
        `${call.llmProviderUsed} ${call.llmSkuUsed} input`, { fallback: fellBack });
  }
  // — LLM output —
  if (call.llmOutputTokens && call.llmOutputTokens > 0) {
    add("LLM", call.llmProviderUsed, call.llmSkuUsed, "LLM_OUTPUT_MTOK",
        call.llmOutputTokens / 1_000_000, "Mtok",
        `${call.llmProviderUsed} ${call.llmSkuUsed} output`, { fallback: fellBack });
  }
  // — STT —
  if (call.sttSeconds && call.sttSeconds > 0) {
    add("STT", call.sttProviderUsed, call.sttSkuUsed, "STT_MINUTE",
        call.sttSeconds / SECONDS_PER_MINUTE, "min",
        `${call.sttProviderUsed} ${call.sttSkuUsed} STT`);
  }
  // — TTS —
  if (call.ttsChars && call.ttsChars > 0) {
    add("TTS", call.ttsProviderUsed, call.ttsSkuUsed, "TTS_KCHARS",
        call.ttsChars / 1000, "kchars",
        `${call.ttsProviderUsed} ${call.ttsSkuUsed} TTS`);
  }
  // — Telephony — pick the SKU by direction so inbound isn't billed at the
  // outbound rate. Inbound is typically zero (rolled into trunk rental).
  if (call.telephonyProvider && call.durationSeconds && call.durationSeconds > 0) {
    const sku = call.direction === "INBOUND" ? "inbound" : "outbound";
    const r = lookup(rateMap, call.telephonyProvider, sku, "TELEPHONY_MINUTE");
    const min = call.durationSeconds / SECONDS_PER_MINUTE;
    // A real 0 rate is not "unavailable" — it means bundled, so skip quietly.
    if (r == null || r > 0) {
      add("TELEPHONY", call.telephonyProvider, sku, "TELEPHONY_MINUTE", min, "min",
          `${call.telephonyProvider} ${sku} telephony`);
    }
  }

  // — Media transport + recording storage —
  // Real usage, but there is NO RateKind that meters either one, so they can
  // only ever be reported as "Rate unavailable". Shown on the Costs page so
  // the breakdown covers the whole pipeline; never given an invented price.
  if (opts.includeUnavailable) {
    if (call.durationSeconds && call.durationSeconds > 0) {
      add("MEDIA", "livekit", "room-minutes", null,
          call.durationSeconds / SECONDS_PER_MINUTE, "min", "LiveKit room time");
    }
    const recSecs = (call as { recordingDurationSeconds?: number | null })
      .recordingDurationSeconds;
    if (recSecs && recSecs > 0) {
      add("RECORDING", "self-hosted", "local-disk", null,
          recSecs / SECONDS_PER_MINUTE, "min", "Recording storage");
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
