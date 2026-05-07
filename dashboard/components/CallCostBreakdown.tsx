// Server component — receives the breakdown from a parent that already has
// access to the live rate map.
import { Coins, AlertTriangle } from "lucide-react";
import type { CostBreakdown } from "@/lib/cost";

export default function CallCostBreakdown({
  breakdown,
}: {
  breakdown: CostBreakdown;
}) {
  if (breakdown.lines.length === 0 && !breakdown.hasUnknownRates) {
    return null;
  }
  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Coins size={16} className="text-emerald-300" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Post-call cost breakdown
          </h2>
        </div>
        <div className="text-base font-bold text-gradient">
          ${breakdown.totalUsd.toFixed(4)}
        </div>
      </div>
      {breakdown.hasUnknownRates && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-2 mb-3 text-[11px] text-amber-200">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Some usage columns have no matching rate row — total below excludes
            those lines.
          </span>
        </div>
      )}
      {breakdown.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-medium">Line item</th>
                <th className="text-right py-1.5 font-medium">Units</th>
                <th className="text-right py-1.5 font-medium">Rate</th>
                <th className="text-right py-1.5 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {breakdown.lines.map((l, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="py-1.5 capitalize">{l.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {l.units < 0.01 ? l.units.toFixed(6) : l.units.toFixed(4)}{" "}
                    <span className="text-[10px] text-gray-500">
                      {l.unitLabel}
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-gray-500">
                    ${l.rateUsd.toFixed(4)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    ${l.costUsd.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
        Cost computed live from current ProviderRate × call usage.
        <br />
        <span className="text-amber-300/70">Estimator caveats:</span> token
        counts are derived at ~4 chars / token from the surviving chat
        context. For calls long enough to trigger context-window
        compression, older messages may be dropped before this snapshot —
        actual input tokens billed by the provider can be higher. STT
        seconds = total call duration; TTS chars = assistant transcript
        length only.
      </p>
    </section>
  );
}
