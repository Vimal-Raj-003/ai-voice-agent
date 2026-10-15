"use client";

// Human Call Forwarding — where a live call goes when the caller asks for a
// person, chosen by what the call is about.
//
// These are hand-off DESTINATIONS and are stored in their own table. They are
// not Vobiz DIDs or SIP trunk records, and editing one here can never alter
// telephony config.
//
// The assistant never sees these numbers. It picks a category name, and the
// worker resolves the destination — which is why there is no "let the caller
// give a number" path anywhere in this UI.
//
// Colours come from the theme tokens, so this reads correctly in light and dark.

import { useState } from "react";
import { PhoneForwarded, AlertTriangle, Info } from "lucide-react";
// Same category list and validation rule the server action uses.
import { TRANSFER_CATEGORIES, E164_RE } from "@/lib/human-transfer";

export type TransferTarget = {
  category: string;
  label: string;
  phoneE164: string | null;
  enabled: boolean;
  priority: number;
};

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

export default function HumanTransferFields({
  targets,
}: {
  targets: TransferTarget[];
}) {
  const byCat = new Map(targets.map((t) => [t.category, t]));
  // Widened from the `as const` literal types, so a partial patch type-checks.
  type Row = { category: string; label: string; hint: string;
               phone: string; enabled: boolean; priority: number };
  const [rows, setRows] = useState<Row[]>(() =>
    TRANSFER_CATEGORIES.map((c): Row => {
      const t = byCat.get(c.category);
      return {
        ...c,
        phone: t?.phoneE164 ?? "",
        enabled: t?.enabled ?? false,
        priority: t?.priority ?? 100,
      };
    }),
  );

  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const anyEnabled = rows.some((r) => r.enabled && r.phone);
  const otherReady = rows.find((r) => r.category === "other")?.enabled
    && !!rows.find((r) => r.category === "other")?.phone;

  return (
    <section className="glass rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Human call forwarding
        </h3>
        <p className="mt-1 text-[11px] text-gray-500">
          When a caller asks for a person, the assistant works out what the call is
          about and hands it to the matching team. It never sees or says these
          numbers — it only chooses a category.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const bad = r.phone.length > 0 && !E164_RE.test(r.phone.trim());
          const enabledNoPhone = r.enabled && !r.phone.trim();
          return (
            <div key={r.category}
                 className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[150px] flex-1">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-[10px] text-gray-500">{r.hint}</div>
                </div>

                <label className="flex-[2] min-w-[190px]">
                  <span className="sr-only">{r.label} phone number</span>
                  <input
                    name={`transfer_${r.category}_phone`}
                    value={r.phone}
                    onChange={(e) => set(i, { phone: e.target.value })}
                    placeholder="+919876543210"
                    inputMode="tel"
                    aria-invalid={bad || undefined}
                    className={`${inputCls} ${bad ? "border-red-500/50" : ""}`}
                  />
                </label>

                <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="sr-only sm:not-sr-only">Priority</span>
                  <input
                    name={`transfer_${r.category}_priority`}
                    type="number" min={1} max={999}
                    value={r.priority}
                    onChange={(e) => set(i, { priority: Number(e.target.value) || 100 })}
                    className={`${inputCls} w-[72px] px-2 py-1.5 text-xs`}
                  />
                </label>

                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-300">
                  <input
                    type="checkbox"
                    name={`transfer_${r.category}_enabled`}
                    checked={r.enabled}
                    onChange={(e) => set(i, { enabled: e.target.checked })}
                    className="accent-violet-400"
                  />
                  Enabled
                </label>
                {/* Unchecked boxes are not submitted; this keeps the category's
                    label in the payload either way. */}
                <input type="hidden" name={`transfer_${r.category}_label`} value={r.label} />
              </div>

              {bad && (
                <p className="callout-bad mt-2 flex items-start gap-1.5 rounded-lg p-2 text-[11px]">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Use E.164 format — a plus, country code, then the number, e.g.
                  +919876543210.
                </p>
              )}
              {enabledNoPhone && !bad && (
                <p className="callout-warn mt-2 flex items-start gap-1.5 rounded-lg p-2 text-[11px]">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Enabled but no number — add one, or switch it off.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="callout-info flex items-start gap-2 rounded-lg p-2.5 text-[11px]">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          {!anyEnabled ? (
            <>No destination is enabled, so the assistant will tell callers that human
              support is unavailable and keep helping them itself.</>
          ) : !otherReady ? (
            <>A category with no number falls back to <strong>Other / General</strong> —
              which is not configured, so those requests will be declined politely.
              Setting it is recommended.</>
          ) : (
            <>A category with no number falls back to <strong>Other / General</strong>.
              Lower priority wins when more than one could serve a request.</>
          )}
        </span>
      </p>

      <p className="flex items-center gap-1.5 text-[10px] text-gray-500">
        <PhoneForwarded size={11} />
        Separate from your Vobiz numbers and SIP trunks — saving here does not change them.
      </p>
    </section>
  );
}
