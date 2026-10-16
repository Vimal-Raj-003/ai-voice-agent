"use client";

// A single monetary value that follows the page's currency choice.
//
// Takes the amount in USD — always the stored/base figure — and formats it at
// render time with the shared rate. Nothing upstream pre-formats a currency
// symbol, which is what made the Overview spend tiles stick to "$".
//
// If INR is selected but no trustworthy rate exists, formatMoney returns "—"
// rather than printing a USD number behind a ₹ sign.
import { formatMoney } from "@/lib/currency";
import { useCurrency } from "@/lib/currency-context";

export default function Money({
  usd,
  decimals = 2,
}: {
  usd: number;
  /** Kept high for per-call and per-unit rates, where cents are not enough. */
  decimals?: number;
}) {
  const { currency, fx } = useCurrency();
  return <>{formatMoney(usd, currency, fx.rate, decimals)}</>;
}
