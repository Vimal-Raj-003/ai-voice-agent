"use client";

// One currency choice, readable by any client leaf on the Overview page.
//
// WHY THIS EXISTS: the Overview stat tiles are rendered on the SERVER and passed
// into the client wrapper as `children`, so they cannot receive the currency as
// a prop — their value strings were already formatted (as USD) before the
// browser ever saw them. That is what left "Spend (14d)" showing $ while INR was
// selected. A context lets a small client leaf (<Money/>) format at render time
// on the client, inside server-rendered markup.
//
// USD stays the base currency. The rate is only ever applied at format time by
// lib/currency.formatMoney, so repeated switching re-derives from the original
// USD number and cannot compound.
import { createContext, useContext } from "react";
import { type Currency, type FxRate } from "@/lib/currency";

type Ctx = { currency: Currency; fx: FxRate };

// Defaults keep any accidental out-of-tree usage in USD rather than rendering a
// rupee symbol over an unconverted number.
const CurrencyCtx = createContext<Ctx>({
  currency: "USD",
  fx: { rate: null, source: "unavailable", asOf: null, error: "no provider" },
});

export function CurrencyProvider({
  currency,
  fx,
  children,
}: Ctx & { children: React.ReactNode }) {
  return (
    <CurrencyCtx.Provider value={{ currency, fx }}>
      {children}
    </CurrencyCtx.Provider>
  );
}

export function useCurrency(): Ctx {
  return useContext(CurrencyCtx);
}
