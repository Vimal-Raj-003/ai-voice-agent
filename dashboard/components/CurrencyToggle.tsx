"use client";

// The USD / INR display toggle, lifted out of CostsView so the Overview header
// and the embedded Costs section render the SAME control rather than two copies.
//
// Behaviour is unchanged from the original: USD is the stored/base currency and
// INR is display-only. When no trustworthy rate is available the INR option is
// disabled and the caption says why — a rate is never invented.
import { type Currency, type FxRate } from "@/lib/currency";

export default function CurrencyToggle({
  fx,
  currency,
  onChange,
  align = "right",
}: {
  fx: FxRate;
  currency: Currency;
  onChange: (c: Currency) => void;
  align?: "left" | "right";
}) {
  const rate = fx.rate;
  const canInr = rate != null;
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
        {(["USD", "INR"] as Currency[]).map((c) => {
          const disabled = c === "INR" && !canInr;
          return (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => onChange(c)}
              aria-pressed={currency === c}
              title={
                disabled
                  ? `Exchange rate unavailable — ${fx.error}`
                  : `Show amounts in ${c}`
              }
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                currency === c
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-gray-400 hover:text-gray-200"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {c === "USD" ? "$ USD" : "₹ INR"}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-gray-500">
        {canInr
          ? currency === "INR"
            ? `1 USD = ₹${rate.toFixed(4)} · ${fx.source === "live" ? "live rate" : "configured rate"}`
            : "Amounts stored in USD"
          : "INR unavailable — no exchange rate"}
      </p>
    </div>
  );
}
