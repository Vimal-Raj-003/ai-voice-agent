"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Loader2, Check, AlertCircle } from "lucide-react";
import type { ProviderRate, RateKind } from "@prisma/client";
import { Badge } from "./Badge";
import { refreshRatesAction } from "@/app/(admin)/costs/actions";

const KIND_LABEL: Record<RateKind, string> = {
  LLM_INPUT_MTOK: "LLM input ($/Mtok)",
  LLM_OUTPUT_MTOK: "LLM output ($/Mtok)",
  STT_MINUTE: "STT ($/min)",
  TTS_KCHARS: "TTS ($/kchars)",
  TELEPHONY_MINUTE: "Telephony ($/min)",
};

const SOURCE_TONE: Record<string, "success" | "info" | "muted"> = {
  OPENROUTER: "success",
  MANUAL: "info",
  DEFAULT: "muted",
};

function formatAge(when: Date): string {
  const minutes = Math.floor((Date.now() - new Date(when).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export default function RatesPanel({ rates }: { rates: ProviderRate[] }) {
  const [pending, start] = useTransition();
  type Result = { kind: "ok" | "warn" | "error"; msg: string };
  const [result, setResult] = useState<Result | null>(null);

  const onRefresh = () =>
    start(async () => {
      try {
        const r = await refreshRatesAction();
        if (r.errors > 0) {
          // Voice-service reached OpenRouter but at least one row failed —
          // partial success deserves an amber warning, not a green checkmark.
          setResult({
            kind: "warn",
            msg: `Refreshed ${r.input + r.output} rows but ${r.errors} fetch error(s) — check voice-service logs.`,
          });
        } else if (r.input + r.output === 0) {
          // Zero rows touched usually means OpenRouter returned an empty
          // body or none of our SKUs were found — surface as warning.
          setResult({
            kind: "warn",
            msg: "OpenRouter returned 0 matching rate rows — none of our SKU lookups matched.",
          });
        } else {
          setResult({
            kind: "ok",
            msg: `Refreshed ${r.input + r.output} LLM rate rows from OpenRouter.`,
          });
        }
      } catch (err) {
        setResult({
          kind: "error",
          msg: err instanceof Error ? err.message : "Refresh failed",
        });
      }
    });

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Provider rates
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            LLM rates auto-refresh from OpenRouter every 3 hrs. STT / TTS /
            telephony are admin-managed (no public pricing API).
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/[0.08] px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/[0.14] transition disabled:opacity-50"
        >
          {pending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {pending ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 mb-3 text-xs ${
            result.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : result.kind === "warn"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {result.kind === "ok" ? (
            <Check size={14} className="shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
          )}
          {result.msg}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-gray-500">
            <tr>
              <th className="text-left py-2 font-medium">Provider</th>
              <th className="text-left py-2 font-medium">SKU</th>
              <th className="text-left py-2 font-medium">Kind</th>
              <th className="text-right py-2 font-medium">Rate (USD)</th>
              <th className="text-left py-2 font-medium pl-2">Source</th>
              <th className="text-left py-2 font-medium">Verified</th>
            </tr>
          </thead>
          <tbody className="text-gray-300">
            {rates.map((r) => (
              <tr
                key={r.id}
                className="border-t border-white/5 hover:bg-white/[0.02]"
              >
                <td className="py-1.5 capitalize">{r.provider}</td>
                <td className="py-1.5 font-mono text-[11px]">{r.sku}</td>
                <td className="py-1.5 text-gray-400">
                  {KIND_LABEL[r.kind]}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  ${Number(r.rateUsd).toFixed(4)}
                </td>
                <td className="py-1.5 pl-2">
                  <Badge tone={SOURCE_TONE[r.source] ?? "muted"}>
                    {r.source}
                  </Badge>
                </td>
                <td className="py-1.5 text-[10px] text-gray-500 font-mono">
                  {formatAge(r.lastVerifiedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
