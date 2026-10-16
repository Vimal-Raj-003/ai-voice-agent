"use client";

// Compact readiness status beside "Run now", replacing the full-width
// readiness card. Click to expand the same checks the card showed.
//
// The state rendered here is computed server-side by lib/campaign-readiness
// and passed in; the same computation gates the Run now server action, so
// collapsing the detail does not weaken enforcement.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, XCircle } from "lucide-react";
import type { ReadinessCheck, ReadinessCounts } from "@/lib/campaign-readiness";

const ICON: Record<ReadinessCheck["state"], React.ReactNode> = {
  ok: <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />,
  warn: <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />,
  fail: <XCircle size={12} className="mt-0.5 shrink-0 text-red-400" />,
  pending: <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-gray-400" />,
};

export default function CampaignReadinessIndicator({
  checks,
  counts,
  canStart,
  /** True while the Run now action is in flight. */
  checking = false,
  /** True when a check could not be evaluated yet. */
  pending = false,
  /**
   * Reason the server refused the last dispatch. When present it OVERRIDES a
   * stale `canStart`: the indicator is rendered from the last server render,
   * so after the action disagrees it must not keep claiming "Ready to run"
   * next to a "Cannot start" error.
   */
  serverRefusal = null,
}: {
  checks: ReadinessCheck[];
  counts: ReadinessCounts;
  canStart: boolean;
  checking?: boolean;
  pending?: boolean;
  serverRefusal?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside click + Escape, matching the other popovers in the dashboard.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const failing = checks.filter((c) => c.state === "fail").length;
  const warnings = checks.filter((c) => c.state === "warn").length;
  const unresolved = checks.filter((c) => c.state === "pending").length;

  // A server refusal always wins over the rendered state.
  const ready = canStart && !serverRefusal;
  const isChecking = checking || (pending && !serverRefusal);
  const blocking = failing + (serverRefusal ? 1 : 0);

  const label = isChecking ? "Checking" : ready ? "Ready to run" : "Not ready";
  const tone = isChecking
    ? "border-white/15 bg-white/[0.04] text-gray-300"
    : ready
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
      : "border-amber-400/30 bg-amber-500/10 text-amber-300";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-readiness={isChecking ? "checking" : ready ? "ready" : "not-ready"}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${tone}`}
      >
        {isChecking ? (
          <Loader2 size={12} className="animate-spin" />
        ) : ready ? (
          <CheckCircle2 size={12} />
        ) : (
          <AlertTriangle size={12} />
        )}
        {label}
        {!isChecking && blocking > 0 && (
          <span className="rounded bg-black/30 px-1 text-[10px]">{blocking}</span>
        )}
        <ChevronDown
          size={11}
          className={`transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Campaign readiness checks"
          // Page-background token, not a hardcoded #0d0f1a: this popover sits
          // inline on the page (no dimmed backdrop), so a fixed dark panel
          // would render as a dark block over a light-theme page.
          style={{ background: "var(--bg-base)", borderColor: "var(--surface-border)" }}
          className="absolute right-0 top-full z-40 mt-1.5 w-[320px] max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border p-3 shadow-2xl"
        >
          <div className="flex flex-wrap gap-1">
            {([
              { k: "Total", v: counts.total, tone: "text-gray-200" },
              { k: "Ready", v: counts.eligible, tone: "text-emerald-400" },
              { k: "Blocked", v: counts.blocked, tone: "text-amber-400" },
              { k: "Invalid", v: counts.invalid, tone: "text-red-400" },
              { k: "Attempted", v: counts.attempted, tone: "text-blue-400" },
            ]).map((c) => (
              <span
                key={c.k}
                className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-gray-400"
              >
                {c.k} <strong className={c.tone}>{c.v}</strong>
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

          {serverRefusal && (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300"
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{serverRefusal}</span>
            </p>
          )}
          {!serverRefusal && failing > 0 && (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300"
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                Run now is blocked until {failing === 1 ? "this check passes" : "these checks pass"}.
              </span>
            </p>
          )}
          {!serverRefusal && unresolved > 0 && (
            <p className="text-[10px] text-gray-500">
              {unresolved} check{unresolved === 1 ? "" : "s"} could not be verified yet — Run now
              stays blocked until {unresolved === 1 ? "it completes" : "they complete"}.
            </p>
          )}
          {!serverRefusal && failing === 0 && warnings > 0 && (
            <p className="text-[10px] text-gray-500">
              {warnings} advisory {warnings === 1 ? "note" : "notes"} — these do not block dispatch.
            </p>
          )}

          <p className="flex items-start gap-1.5 text-[10px] text-gray-500">
            <Info size={11} className="mt-0.5 shrink-0" />
            Passing means the campaign can be dispatched, not that every call will
            connect. Do-not-call and quiet hours are re-checked per number at dial
            time, and concurrency is clamped to the provider limit.
          </p>
        </div>
      )}
    </div>
  );
}
