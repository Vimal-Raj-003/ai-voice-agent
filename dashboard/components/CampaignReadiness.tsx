// Pre-flight summary for a campaign. Server-rendered; no client JS.
//
// This reports what can be checked BEFORE dialing. It deliberately does not
// claim calls will succeed: DNC and quiet hours are re-evaluated per number at
// dial time by compliance.check_dispatch_allowed, and the real concurrency
// ceiling is the strictest of the request, the provider account limit and the
// trunk limit, resolved by the dispatcher at run time.
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export type ReadinessCheck = {
  label: string;
  state: "ok" | "warn" | "fail";
  detail: string;
};

export type ReadinessCounts = {
  total: number;
  eligible: number;
  blocked: number;
  invalid: number;
  attempted: number;
};

const ICON = {
  ok: <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />,
  warn: <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />,
  fail: <XCircle size={12} className="mt-0.5 shrink-0 text-red-400" />,
};

export default function CampaignReadiness({
  checks,
  counts,
  canStart,
}: {
  checks: ReadinessCheck[];
  counts: ReadinessCounts;
  canStart: boolean;
}) {
  const chips: { k: string; v: number; tone: string }[] = [
    { k: "Total", v: counts.total, tone: "text-gray-200" },
    { k: "Ready", v: counts.eligible, tone: "text-emerald-400" },
    { k: "Blocked", v: counts.blocked, tone: "text-amber-400" },
    { k: "Invalid", v: counts.invalid, tone: "text-red-400" },
    { k: "Attempted", v: counts.attempted, tone: "text-blue-400" },
  ];
  const failures = checks.filter((c) => c.state === "fail");

  return (
    <section className="glass min-w-0 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Readiness
        </h2>
        <span
          className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
            canStart
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-400/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          {canStart ? "Ready to start" : "Not ready"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c.k}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-gray-400"
          >
            {c.k} <strong className={`ml-0.5 text-xs ${c.tone}`}>{c.v}</strong>
          </span>
        ))}
      </div>

      <ul className="space-y-1">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-1.5 text-[11px]">
            {ICON[c.state]}
            <span className="min-w-0">
              <span className="text-gray-300">{c.label}</span>
              <span className="text-gray-500"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {failures.length > 0 && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Cannot start yet: {failures.map((f) => f.label.toLowerCase()).join("; ")}.
          </span>
        </p>
      )}

      <p className="flex items-start gap-1.5 text-[10px] text-gray-500">
        <Info size={11} className="mt-0.5 shrink-0" />
        Passing these checks means the campaign can be dispatched — not that every
        call will connect. Do-not-call and quiet hours are re-checked per number
        at dial time, and the dispatcher applies the strictest of your requested
        concurrency, the provider account limit and the trunk limit.
      </p>
    </section>
  );
}
