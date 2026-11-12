// Usage × rates. Native calls retain a rate receipt at completion; older
// calls without that receipt explicitly use the currently configured rates.

import type {
  Call,
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
  rateBasis?: 'call_snapshot'|'current_rates';
  ratesCapturedAt?: string|null;
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

type NativeUsage = {mode?:string;engine?:string;provider?:string;model?:string;complete?:boolean;tokens?:Record<string,number>;speechInput?:{provider:string;model:string;seconds:number;source:string};rateSnapshot?:{version:number;capturedAt:string;rows:{provider:string;sku:string;kind:RateKind;rateUsd:number}[]}};
export function voiceUsage(metadata:unknown): NativeUsage | null {
  if (!metadata || typeof metadata !== "object") return null;
  const usage = (metadata as {voiceUsage?:unknown}).voiceUsage;
  return usage && typeof usage === "object" ? usage as NativeUsage : null;
}
export function callChannel(call:{metadata?:unknown;direction:string;fromNumber?:string|null;toNumber?:string|null}) {
  return voiceUsage(call.metadata)?.mode === "demo" || call.fromNumber === "demo-user" || call.toNumber === "browser-demo"
    ? "Demo" : call.direction === "INBOUND" ? "Inbound" : "Outbound";
}
export type ChannelSpend = {channel:string;calls:number;minutes:number;pricedUsd:number;incomplete:number};
export function channelSpending(calls:CallCostInput[], rates:Map<string,number>):ChannelSpend[] {
  return ["Demo","Inbound","Outbound"].map(channel=>{
    const rows=calls.filter(c=>callChannel(c)===channel);
    const costs=rows.map(c=>computeCallCost(c,rates,{includeUnavailable:true}));
    return {channel,calls:rows.length,minutes:rows.reduce((sum,c)=>sum+(c.durationSeconds||0)/60,0),
      pricedUsd:costs.reduce((sum,c)=>sum+c.totalUsd,0),incomplete:costs.filter(c=>c.hasUnknownRates).length};
  });
}

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
> & {metadata?:unknown;fromNumber?:string|null;toNumber?:string|null};

export function computeCallCost(
  call: CallCostInput,
  rateMap: Map<string, number>,
  opts: CostOptions = {},
): CostBreakdown {
  const lines: CostLine[] = [];
  let unknown = false;
  const receipt = voiceUsage(call.metadata);
  const snapshot=receipt?.rateSnapshot;
  const frozen=snapshot?.version===1&&Array.isArray(snapshot.rows);
  if(frozen){
    rateMap=new Map(rateMap);
    for(const modality of ['audio','text'])for(const kind of ['LLM_INPUT_MTOK','LLM_OUTPUT_MTOK'])
      rateMap.delete(`google|${call.llmSkuUsed||receipt?.model}/${modality}|${kind}`);
    if(receipt?.speechInput?.provider==='sarvam')
      rateMap.delete(`sarvam|${receipt.speechInput.model}|STT_MINUTE`);
    for(const row of snapshot.rows){
      const speechRate=row.provider==='sarvam'&&row.provider===receipt?.speechInput?.provider&&
        row.sku===receipt.speechInput.model&&row.kind==='STT_MINUTE';
      if((row.provider==='google'||speechRate)&&Number.isFinite(row.rateUsd)&&row.rateUsd>=0)
        rateMap.set(`${row.provider}|${row.sku}|${row.kind}`,row.rateUsd);
    }
  }

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

  const billedProvider = call.llmProviderUsed || receipt?.provider;
  const billedModel = call.llmSkuUsed || receipt?.model;
  const native = billedProvider === "google" && /^gemini-.*live/.test(billedModel || "");
  if (native) {
    const saved = voiceUsage(call.metadata);
    if (!saved || saved.complete !== true) unknown = true;
    if (saved?.tokens) {
      for (const [field,modality,kind] of [
        ["inputAudio","audio","LLM_INPUT_MTOK"], ["inputText","text","LLM_INPUT_MTOK"],
        ["outputAudio","audio","LLM_OUTPUT_MTOK"], ["outputText","text","LLM_OUTPUT_MTOK"],
      ] as const) {
        const count = Number(saved.tokens[field] || 0);
        if (count>0) add("LLM","google",`${billedModel}/${modality}`,kind,count/1_000_000,"Mtok",`Gemini Live ${modality} ${kind === "LLM_INPUT_MTOK" ? "input" : "output"}`);
      }
    }
    if ((!saved || !saved.complete) && opts.includeUnavailable) lines.push({
      label:"Native audio/text usage incomplete",provider:"google",sku:billedModel || "",kind:null,
      category:"LLM",units:Number(saved?.tokens?.unclassified||0),unitLabel:"unclassified tokens",rateUsd:null,costUsd:0,unavailable:true,
    });
  }
  // Cascaded models retain their existing meters.
  if (!native && call.llmInputTokens && call.llmInputTokens > 0) {
    add("LLM", call.llmProviderUsed, call.llmSkuUsed, "LLM_INPUT_MTOK",
        call.llmInputTokens / 1_000_000, "Mtok",
        `${call.llmProviderUsed} ${call.llmSkuUsed} input`, { fallback: fellBack });
  }
  // — LLM output —
  if (!native && call.llmOutputTokens && call.llmOutputTokens > 0) {
    add("LLM", call.llmProviderUsed, call.llmSkuUsed, "LLM_OUTPUT_MTOK",
        call.llmOutputTokens / 1_000_000, "Mtok",
        `${call.llmProviderUsed} ${call.llmSkuUsed} output`, { fallback: fellBack });
  }
  // — STT —
  if ((!native || (receipt?.speechInput?.provider === 'sarvam' && call.sttProviderUsed === 'sarvam')) && call.sttSeconds && call.sttSeconds > 0) {
    // GPT-Live reuses the existing duration meter; it replaces both STT/TTS.
    const nativeAudio = call.sttProviderUsed === "openai" && call.sttSkuUsed === "gpt-live-1";
    add(nativeAudio ? "LLM" : "STT", call.sttProviderUsed, call.sttSkuUsed, "STT_MINUTE",
        call.sttSeconds / SECONDS_PER_MINUTE, "min",
        nativeAudio ? "OpenAI GPT-Live full-duplex audio" : `${call.sttProviderUsed} ${call.sttSkuUsed} STT`);
  }
  // — TTS —
  if (!native && call.ttsChars && call.ttsChars > 0) {
    add("TTS", call.ttsProviderUsed, call.ttsSkuUsed, "TTS_KCHARS",
        call.ttsChars / 1000, "kchars",
        `${call.ttsProviderUsed} ${call.ttsSkuUsed} TTS`);
  }
  // — Telephony — pick the SKU by direction so inbound isn't billed at the
  // outbound rate. Inbound is typically zero (rolled into trunk rental).
  if (callChannel(call)!=='Demo' && call.telephonyProvider && call.durationSeconds && call.durationSeconds > 0) {
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
  return { totalUsd, lines, hasUnknownRates: unknown,rateBasis:frozen?'call_snapshot':'current_rates',ratesCapturedAt:frozen?snapshot.capturedAt:null };
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
  mode: "days" | "hours" = "days",
): CostAggregate {
  const today = new Date();
  const dayKeys: string[] = [];
  if (mode === "hours") {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(Date.now() - i * 60 * 60 * 1000);
      dayKeys.push(`${d.toISOString().slice(0, 13)}:00`.replace("T", " "));
    }
  } else {
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
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
    const callDate = new Date(c.createdAt);
    const dayKey = mode === "hours"
      ? `${callDate.toISOString().slice(0, 13)}:00`.replace("T", " ")
      : callDate.toISOString().slice(0, 10);
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
