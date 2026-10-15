"use client";

// The Costs page body. Everything here is driven by ONE currency choice and
// ONE exchange rate, so the stat cards, both charts, the provider totals, the
// per-call table and every expanded breakdown always agree.
//
// All amounts arrive as USD (ProviderRate is USD by definition) and are
// converted only for display — nothing is ever stored or aggregated in INR.
//
// Costs come from the ACTUAL runtime provider recorded on the call
// (llmProviderUsed / sttProviderUsed / ttsProviderUsed), never inferred from a
// model name: a Groq-served "openai/gpt-oss-20b" is billed to Groq.

import { useMemo, useRef, useState } from "react";
import {
  CircleDollarSign, Phone, Clock, Coins, AlertTriangle, ChevronRight,
} from "lucide-react";
import StatCard from "./StatCard";
import CostStackedBar from "./charts/CostStackedBar";
import CostByProvider from "./charts/CostByProvider";
import { COST_CATEGORY_LABEL, type CostCategory, type CostLine } from "@/lib/cost";
import { type Currency, type FxRate, formatMoney } from "@/lib/currency";

export type CallCostRow = {
  id: string;
  phone: string;
  direction: string;
  status: string;
  createdAtIso: string;
  durationSeconds: number | null;
  totalUsd: number;
  hasUnknownRates: boolean;
  lines: CostLine[];
};

type Props = {
  fx: FxRate;
  totalUsd: number;
  totalCalls: number;
  avgPerCallUsd: number;
  totalMinutes: number;
  todayUsd: number;
  monthUsd: number;
  byDay: Array<{ date: string } & Record<string, number | string>>;
  byProvider: Array<{ provider: string; costUsd: number }>;
  activeProviders: string[];
  calls: CallCostRow[];
};

/** How many calls are revealed at a time. */
const PAGE_SIZE = 5;

const CATEGORY_ORDER: CostCategory[] = [
  "TELEPHONY", "MEDIA", "STT", "LLM", "TTS", "RECORDING",
];

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

// Fixed locale + UTC so the server and client render identical text (a
// locale-dependent string here would cause a hydration mismatch).
const DT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZone: "UTC",
});

const STATUS_TONE: Record<string, string> = {
  COMPLETED: "text-emerald-300 bg-emerald-500/10",
  FAILED: "text-red-300 bg-red-500/10",
  NO_ANSWER: "text-amber-300 bg-amber-500/10",
  BUSY: "text-amber-300 bg-amber-500/10",
  CANCELED: "text-gray-400 bg-white/5",
};

export default function CostsView(p: Props) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [openId, setOpenId] = useState<string | null>(null);
  // The call list can run to hundreds of rows, so it starts compact and grows
  // a page at a time instead of dominating the screen. No data is dropped —
  // only how much of it is on screen changes.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const callSectionRef = useRef<HTMLElement>(null);

  const rate = p.fx.rate;
  const canInr = rate != null;
  const money = (usd: number, d = 2) => formatMoney(usd, currency, rate, d);

  // Newest first.
  const sortedCalls = useMemo(
    () => [...p.calls].sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso)),
    [p.calls],
  );
  const visibleCalls = sortedCalls.slice(0, visibleCount);
  const allShown = visibleCount >= sortedCalls.length;

  const showMore = () =>
    setVisibleCount((n) => Math.min(n + PAGE_SIZE, sortedCalls.length));

  const showLess = () => {
    setVisibleCount(PAGE_SIZE);
    // An expanded row that is about to be hidden would otherwise stay "open"
    // and reappear unexpectedly on the next Show more.
    setOpenId((id) =>
      id && sortedCalls.slice(0, PAGE_SIZE).some((c) => c.id === id) ? id : null,
    );
    // Collapsing removes rows above the fold, so put the section back in view
    // rather than leaving the viewport stranded below the page content.
    callSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Costs</h1>
          <p className="mt-1 text-sm text-gray-400">
            Per-call spend computed live from{" "}
            <span className="text-gray-300">usage × current ProviderRate</span>,
            attributed to the provider that actually served the call.
          </p>
        </div>

        {/* Currency toggle — one rate for the whole page. */}
        <div className="text-right">
          <div className="inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
            {(["USD", "INR"] as Currency[]).map((c) => {
              const disabled = c === "INR" && !canInr;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={disabled}
                  onClick={() => setCurrency(c)}
                  title={disabled ? `Exchange rate unavailable — ${p.fx.error}` : `Show amounts in ${c}`}
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
                ? `1 USD = ₹${rate!.toFixed(4)} · ${p.fx.source === "live" ? "live rate" : "configured rate"}`
                : "Amounts stored in USD"
              : "INR unavailable — no exchange rate"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="14-day total" value={money(p.totalUsd)} icon={CircleDollarSign} tone="cyan" />
        <StatCard label="Today" value={money(p.todayUsd, 4)} icon={Coins} tone="violet" />
        <StatCard label="This month" value={money(p.monthUsd)} icon={CircleDollarSign} tone="emerald" />
        <StatCard label="Avg / call" value={money(p.avgPerCallUsd, 4)} icon={Phone} tone="magenta" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Calls" value={p.totalCalls} icon={Phone} tone="violet" />
        <StatCard label="Minutes used" value={p.totalMinutes.toFixed(1)} icon={Clock} tone="cyan" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              Daily spend by provider
            </h2>
            <span className="font-mono text-[10px] text-gray-500">14 days</span>
          </div>
          {p.totalCalls === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-gray-500">
              No calls in the last 14 days yet — once a call completes, the cost lands here.
            </div>
          ) : (
            <CostStackedBar data={p.byDay} providers={p.activeProviders}
                            currency={currency} fxRate={rate} />
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-gray-300">
            By provider
          </h2>
          {p.byProvider.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">
              No spend yet.
            </div>
          ) : (
            <>
              <CostByProvider data={p.byProvider} currency={currency} fxRate={rate} />
              <ul className="mt-3 space-y-1 text-[11px]">
                {p.byProvider.map((x) => (
                  <li key={x.provider} className="flex items-center justify-between text-gray-400">
                    <span className="capitalize">{x.provider}</span>
                    <span className="font-mono tabular-nums text-gray-300">
                      {money(x.costUsd, 4)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {/* ── Cost by call ──────────────────────────────────────────────── */}
      <section ref={callSectionRef} className="glass scroll-mt-4 rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Cost by call
          </h2>
          <span className="text-right text-[10px] text-gray-500">
            {sortedCalls.length > 0 && (
              <span className="mr-2 font-mono text-gray-400">
                {visibleCalls.length} of {sortedCalls.length}
              </span>
            )}
            Click a call for its provider-by-provider breakdown
          </span>
        </div>

        {sortedCalls.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">No calls in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Date / time</th>
                  <th className="py-2 pr-3 font-medium">Duration</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pl-3 text-right font-medium">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {visibleCalls.map((c) => {
                  const open = openId === c.id;
                  return (
                    <CallRows
                      key={c.id}
                      call={c}
                      open={open}
                      onToggle={() => setOpenId(open ? null : c.id)}
                      money={money}
                      currency={currency}
                      rate={rate}
                    />
                  );
                })}
              </tbody>
            </table>

            {/* Progressive reveal: 5 more per click, then collapse back. */}
            {sortedCalls.length > PAGE_SIZE && (
              <div className="mt-3 flex flex-col items-center gap-1 border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={allShown ? showLess : showMore}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-gray-200 transition hover:bg-white/[0.08]"
                >
                  {allShown ? "Show less" : "Show more"}
                </button>
                <span className="text-[10px] text-gray-500">
                  {allShown
                    ? `All ${sortedCalls.length} calls shown`
                    : `${sortedCalls.length - visibleCalls.length} more call${
                        sortedCalls.length - visibleCalls.length === 1 ? "" : "s"
                      }`}
                </span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CallRows({
  call, open, onToggle, money, currency, rate,
}: {
  call: CallCostRow;
  open: boolean;
  onToggle: () => void;
  money: (usd: number, d?: number) => string;
  currency: Currency;
  rate: number | null;
}) {
  // Group the lines by pipeline stage so the breakdown reads the way the call
  // actually flows, and so an unmetered stage can still show its real usage.
  const byCategory = useMemo(() => {
    const m = new Map<CostCategory, CostLine[]>();
    for (const l of call.lines) {
      const arr = m.get(l.category) ?? [];
      arr.push(l);
      m.set(l.category, arr);
    }
    return m;
  }, [call.lines]);

  // The displayed total is the SUM OF THE LINES above it, so the breakdown
  // always reconciles exactly with the row's total.
  const summed = call.lines.reduce((s, l) => s + l.costUsd, 0);
  const unpriced = call.lines.filter((l) => l.unavailable);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-white/5 transition hover:bg-white/[0.03] ${
          open ? "bg-violet-500/[0.06]" : ""
        }`}
      >
        <td className="py-2.5 pr-3">
          <span className="flex items-center gap-1.5">
            <ChevronRight
              size={12}
              className={`shrink-0 text-gray-500 transition ${open ? "rotate-90" : ""}`}
            />
            <span className="font-mono text-fg">{call.phone}</span>
            <span className="text-[9px] uppercase text-gray-500">{call.direction}</span>
          </span>
        </td>
        <td className="py-2.5 pr-3 font-mono text-gray-400">
          {DT.format(new Date(call.createdAtIso))}
        </td>
        <td className="py-2.5 pr-3 font-mono text-gray-400">{fmtDuration(call.durationSeconds)}</td>
        <td className="py-2.5 pr-3">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            STATUS_TONE[call.status] ?? "bg-white/5 text-gray-400"}`}>
            {call.status}
          </span>
        </td>
        <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-fg">
          {money(call.totalUsd, 4)}
          {call.hasUnknownRates && (
            <span className="ml-1 text-[9px] text-amber-300" title="Some usage on this call has no rate">
              ⚠
            </span>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-white/10 bg-black/20">
          <td colSpan={5} className="px-3 py-4">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-gray-500">
                  <th className="py-1 pr-3 font-medium">Provider</th>
                  <th className="py-1 pr-3 font-medium">Model</th>
                  <th className="py-1 pr-3 text-right font-medium">Usage</th>
                  <th className="py-1 pr-3 text-right font-medium">Rate</th>
                  <th className="py-1 pl-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => (
                  <Fragmentish key={cat} label={COST_CATEGORY_LABEL[cat]}>
                    {byCategory.get(cat)!.map((l, i) => (
                      <tr key={`${cat}-${i}`} className="border-b border-white/5 last:border-0">
                        <td className="py-1.5 pr-3 capitalize text-gray-300">
                          {l.provider}
                          {l.fallback && (
                            <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-300"
                                  title="A fallback model served this call, not the assistant's configured model">
                              fallback
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-gray-400">{l.sku}</td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-gray-400">
                          {l.units < 0.01 ? l.units.toFixed(6) : l.units.toFixed(4)}{" "}
                          <span className="text-[9px] text-gray-600">{l.unitLabel}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-gray-500">
                          {l.rateUsd == null
                            ? <span className="text-amber-300">Rate unavailable</span>
                            : `${formatMoney(l.rateUsd, currency, rate, 4)}/${l.unitLabel}`}
                        </td>
                        <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-gray-200">
                          {l.rateUsd == null ? "—" : money(l.costUsd, 6)}
                        </td>
                      </tr>
                    ))}
                  </Fragmentish>
                ))}
                <tr className="border-t border-white/15">
                  <td colSpan={4} className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-300">
                    Total call cost
                  </td>
                  <td className="py-2 pl-3 text-right font-mono tabular-nums text-sm font-semibold text-fg">
                    {money(summed, 6)}
                  </td>
                </tr>
              </tbody>
            </table>

            {unpriced.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-300">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>
                  {unpriced.length} line{unpriced.length === 1 ? "" : "s"} have real usage but no
                  rate in ProviderRate, so they are excluded from the total rather than estimated.
                </span>
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** A labelled group header row inside the breakdown table. */
function Fragmentish({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-violet-300/70">
          {label}
        </td>
      </tr>
      {children}
    </>
  );
}
