"use client";

// Owns the ONE currency choice for the Overview page, and the two collapsible
// panels beside the Costs & Usage heading.
//
// The toggle sits in the page header (top-right) while the money it affects is
// at the bottom, so this client component spans both: the header slot and the
// costs block render here, and the existing server-rendered Overview widgets
// pass straight through as `children`.
//
// Those server-rendered children cannot take the currency as a prop — their
// markup is produced before the browser sees it — so the choice is also
// published through CurrencyProvider, letting a small <Money/> leaf inside a
// server-rendered StatCard format on the client. That is what fixes the
// "Spend (14d) stays in $" bug.
//
// USD remains the stored/base currency; INR is applied only at format time by
// lib/currency.formatMoney, so switching back and forth re-derives from the
// original USD number and cannot compound.
import { useState } from "react";
import { ChevronDown, Table2, ReceiptText } from "lucide-react";
import { type FxRate } from "@/lib/currency";
import { useCurrency } from "@/lib/currency-context";
import CurrencyToggle from "@/components/CurrencyToggle";
import CostsView, { type CostsViewProps } from "@/components/CostsView";
import Money from "./Money";
import type {ChannelSpend} from "@/lib/cost";

type Panel = "rates" | "calls" | null;

export default function OverviewCosts({
  fx: initialFx,
  header,
  actions,
  children,
  costs,
  ratesPanel,
  channelSpend = [],
}: {
  fx: FxRate;
  /** The page title block, rendered beside the toggle. */
  header: React.ReactNode;
  /** Action controls rendered alongside the currency toggle (e.g. RangeSelector). */
  actions?: React.ReactNode;
  /** The existing Overview widgets, untouched. */
  children: React.ReactNode;
  /** Exactly the money/usage props CostsView already accepts, so this wrapper
      can never drift from the component it renders. */
  costs: Omit<CostsViewProps, "fx" | "currency" | "onCurrencyChange" | "hideToggle" | "showCalls">;
  /** The existing RatesPanel, server-rendered once and only revealed on demand
      — mounting it here rather than re-fetching on each expand. */
  ratesPanel: React.ReactNode;
  channelSpend?:ChannelSpend[];
}) {
  const {currency, setCurrency, fx} = useCurrency();
  void initialFx;
  const [panel, setPanel] = useState<Panel>(null);

  const btn = (id: Exclude<Panel, null>, label: string, Icon: typeof Table2) => {
    const open = panel === id;
    return (
      <button
        type="button"
        onClick={() => setPanel(open ? null : id)}
        aria-expanded={open}
        aria-controls={`panel-${id}`}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
          open
            ? "border-violet-400/40 bg-violet-400/10 text-violet-200"
            : "border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.08] hover:text-white"
        }`}
      >
        <Icon size={12} /> {label}
        <ChevronDown
          size={12}
          className={`transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
    );
  };

  return (
    <>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {header}
          <div className="flex items-center gap-3">
            {actions}
            <CurrencyToggle fx={fx} currency={currency} onChange={setCurrency} />
          </div>
        </div>

        {children}

        <section id="costs" className="space-y-4 scroll-mt-6">
          <div className="rounded-xl border border-white/10 p-4 sm:p-5 space-y-3">
            <h2 className="text-lg font-semibold">Spend by call type</h2>
            <p className="max-w-3xl text-sm text-gray-400">Priced usage for the selected date range. Demo and phone calls are tracked separately. Unpriced provider, media or storage usage is marked incomplete; these figures are estimates, not an invoice.</p>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-gray-400"><tr><th className="py-3 pr-4 font-medium">Call type</th><th className="p-3 font-medium">Calls</th><th className="p-3 font-medium">Minutes</th><th className="p-3 font-medium">Priced cost</th><th className="p-3 font-medium">Coverage</th></tr></thead>
              <tbody>{channelSpend.map(row=><tr key={row.channel} className="border-t border-white/10">
                <th className="py-3 pr-4 font-medium">{row.channel}</th><td className="p-3 tabular-nums">{row.calls}</td><td className="p-3 tabular-nums">{row.minutes.toFixed(1)}</td>
                <td className="p-3 whitespace-nowrap"><Money usd={row.pricedUsd} decimals={4}/></td><td className="p-3 text-gray-400">{!row.calls?'No recorded usage':row.incomplete?`${row.incomplete} incomplete`:'All recorded meters priced'}</td>
              </tr>)}</tbody>
            </table></div>
            <p className="text-xs text-gray-400">Published paid-rate estimates; free-tier credits and invoices may differ. Browser demo tracking starts with this update. Earlier recordings without a usage ledger cannot be priced accurately.</p>
          </div>
          {/* Single Costs & Usage heading, with both panel buttons beside it.
              They wrap under the heading on narrow screens. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-bold">Costs &amp; Usage</h2>
            <div className="flex flex-wrap items-center gap-2">
              {btn("rates", "Provider Rates", Table2)}
              {btn("calls", "Cost By Call", ReceiptText)}
            </div>
          </div>

          {/* Summary cards + charts stay permanently visible; only the two big
              tables moved behind the buttons. */}
          <CostsView
            fx={fx}
            currency={currency}
            onCurrencyChange={setCurrency}
            hideToggle
            showCalls={false}
            totalUsd={costs.totalUsd}
            totalCalls={costs.totalCalls}
            avgPerCallUsd={costs.avgPerCallUsd}
            totalMinutes={costs.totalMinutes}
            todayUsd={costs.todayUsd}
            monthUsd={costs.monthUsd}
            byDay={costs.byDay}
            byProvider={costs.byProvider}
            activeProviders={costs.activeProviders}
            calls={costs.calls}
          />

          {panel === "rates" && (
            <div id="panel-rates">{ratesPanel}</div>
          )}

          {panel === "calls" && (
            <div id="panel-calls">
              {/* The same CostsView, rendering ONLY its Cost-by-call section —
                  so expandable rows, Show more, the unverified-rate warnings
                  and the currency all behave exactly as before. */}
              <CostsView
                fx={fx}
                currency={currency}
                onCurrencyChange={setCurrency}
                hideToggle
                showCalls
                showSummary={false}
                totalUsd={costs.totalUsd}
                totalCalls={costs.totalCalls}
                avgPerCallUsd={costs.avgPerCallUsd}
                totalMinutes={costs.totalMinutes}
                todayUsd={costs.todayUsd}
                monthUsd={costs.monthUsd}
                byDay={costs.byDay}
                byProvider={costs.byProvider}
                activeProviders={costs.activeProviders}
                calls={costs.calls}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
