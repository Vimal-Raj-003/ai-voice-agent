// USD→INR for the Costs page.
//
// Costs are COMPUTED AND STORED IN USD everywhere (ProviderRate.rateUsd is USD
// by definition). INR is a DISPLAY conversion only — one rate is fetched once
// per render and applied across the whole page, so every figure on screen is
// consistent with every other.
//
// The rate is real, never invented: it comes from the open.er-api.com feed, or
// from a USD_INR_RATE override for air-gapped installs. If neither is
// available the page stays in USD and says why rather than guessing.

export type FxRate = {
  /** INR per 1 USD. null = no trustworthy rate, so INR must stay disabled. */
  rate: number | null;
  /** Where the number came from, shown next to the toggle. */
  source: "live" | "manual" | "unavailable";
  /** ISO date the feed last updated (live only). */
  asOf: string | null;
  error: string;
};

const FEED = "https://open.er-api.com/v6/latest/USD";

export async function getUsdInrRate(): Promise<FxRate> {
  // A manual override wins — it lets an install pin a contracted rate, and
  // keeps the page working with no outbound network access.
  const manual = Number(process.env.USD_INR_RATE || "");
  if (Number.isFinite(manual) && manual > 0) {
    return { rate: manual, source: "manual", asOf: null, error: "" };
  }
  try {
    // Cached by Next for an hour: FX moves far slower than this page reloads.
    const r = await fetch(FEED, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`feed returned ${r.status}`);
    const j = (await r.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    const inr = j?.rates?.INR;
    if (j?.result !== "success" || typeof inr !== "number" || !(inr > 0)) {
      throw new Error("feed did not return a usable INR rate");
    }
    return {
      rate: inr,
      source: "live",
      asOf: j.time_last_update_utc ?? null,
      error: "",
    };
  } catch (e) {
    return {
      rate: null,
      source: "unavailable",
      asOf: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type Currency = "USD" | "INR";

/**
 * Format a USD amount in the chosen currency.
 * `decimals` keeps sub-cent precision visible for per-line costs.
 */
export function formatMoney(
  usd: number,
  currency: Currency,
  rate: number | null,
  decimals = 2,
): string {
  if (currency === "INR") {
    // Guarded by the UI (the toggle is disabled without a rate); this is the
    // belt-and-braces path so a bad rate can never render a fake number.
    if (!rate) return "—";
    return `₹${(usd * rate).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Symbol for axis ticks and chart tooltips. */
export function currencySymbol(currency: Currency): string {
  return currency === "INR" ? "₹" : "$";
}
