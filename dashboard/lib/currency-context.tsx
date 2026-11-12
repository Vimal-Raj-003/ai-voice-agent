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
import { createContext, useContext, useSyncExternalStore } from "react";
import { type Currency, type FxRate } from "@/lib/currency";

type Ctx = { currency: Currency; fx: FxRate; setCurrency: (currency: Currency) => void };
const STORAGE_KEY = "jilljill.currency";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("jilljill-currency", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("jilljill-currency", listener); };
}
function snapshot(): Currency {
  try { return localStorage.getItem(STORAGE_KEY) === "INR" ? "INR" : "USD"; }
  catch { return "USD"; }
}
function persist(currency: Currency) {
  try { localStorage.setItem(STORAGE_KEY, currency); } catch { return; }
  window.dispatchEvent(new Event("jilljill-currency"));
}

// Defaults keep any accidental out-of-tree usage in USD rather than rendering a
// rupee symbol over an unconverted number.
const CurrencyCtx = createContext<Ctx>({
  currency: "USD",
  fx: { rate: null, source: "unavailable", asOf: null, error: "no provider" },
  setCurrency: () => {},
});

export function CurrencyProvider({
  fx,
  children,
}: { fx: FxRate; children: React.ReactNode }) {
  const preferred = useSyncExternalStore(subscribe, snapshot, () => "USD" as Currency);
  const currency = preferred === "INR" && !fx.rate ? "USD" : preferred;
  return (
    <CurrencyCtx.Provider value={{ currency, fx, setCurrency: persist }}>
      {children}
    </CurrencyCtx.Provider>
  );
}

export function useCurrency(): Ctx {
  return useContext(CurrencyCtx);
}
