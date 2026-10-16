"use client";

// Human call forwarding, presented as PEOPLE.
//
// Each row is "Person N", and beside it the kind of call that reaches them.
// That second part is not decoration: transfer is INTENT-routed. The assistant
// is given the four category names and their hints and picks one from what the
// caller wants — it never sees a number. So a row has to show which intent a
// person serves, or the operator cannot tell that Person 1 gets the technical
// calls.
//
// WHY ONLY FOUR SLOTS: `human_transfer_targets.category` carries a database
// CHECK constraint limiting it to software | marketing | content | other, the
// pair (assistant_id, category) is UNIQUE, and the worker's
// HUMAN_TRANSFER_CATEGORIES tuple rejects anything else. Arbitrary "person_5"
// is therefore unstorable without a migration and a worker change, so "Add New"
// fills the next free slot and stops at 4.
//
// This is a presentation layer only: the submitted field names
// (transfer_<category>_phone / _enabled / _label / _priority) and the server
// action are exactly as before, so saved records stay compatible.
import { useState } from "react";
import { AlertTriangle, ChevronRight, Plus, X } from "lucide-react";
import { TRANSFER_CATEGORIES, E164_RE } from "@/lib/human-transfer";
import InfoTooltip from "./InfoTooltip";

export type TransferTarget = {
  category: string;
  label: string;
  phoneE164: string | null;
  enabled: boolean;
  priority: number;
};

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

// Compact variant for the forwarding rows: same look, half the vertical box.
// Written out rather than composed from inputCls, because duplicate padding
// utilities resolve by CSS source order, not class-attribute order.
const compactInputCls =
  "w-full min-w-0 rounded-md border border-white/10 bg-black/30 px-2 py-[3px] font-mono text-[11px] leading-4 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

export default function HumanTransferFields({
  targets,
}: {
  targets: TransferTarget[];
}) {
  const byCat = new Map(targets.map((t) => [t.category, t]));
  type Row = {
    category: string;
    /** What the backend stores as `label` (and the agent may speak). */
    label: string;
    hint: string;
    phone: string;
    enabled: boolean;
    /** Stored priority, preserved verbatim — see the hidden input below. */
    priority: number;
    /** Whether this slot is shown as a configured person. */
    present: boolean;
  };

  const [rows, setRows] = useState<Row[]>(() =>
    TRANSFER_CATEGORIES.map((c): Row => {
      const t = byCat.get(c.category);
      return {
        ...c,
        phone: t?.phoneE164 ?? "",
        enabled: t?.enabled ?? false,
        // A missing row keeps the server action's own default of 100 so nothing
        // is invented for a slot that was never configured.
        priority: t?.priority ?? 100,
        // Show a slot as a person when it already exists in the database.
        present: !!t,
      };
    }),
  );

  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const shown = rows.filter((r) => r.present);
  const nextFree = rows.findIndex((r) => !r.present);
  const anyEnabled = shown.some((r) => r.enabled && r.phone);
  const otherRow = rows.find((r) => r.category === "other");
  const otherReady = !!otherRow?.present && otherRow.enabled && !!otherRow.phone;

  const addPerson = () => {
    if (nextFree === -1) return;
    set(nextFree, { present: true, enabled: false });
  };

  // Removing only clears the row's inputs; the server action decides what that
  // means for the stored record, exactly as when a number is emptied by hand.
  const removePerson = (i: number) =>
    set(i, { present: false, phone: "", enabled: false });

  return (
    <section className="glass rounded-2xl p-3 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h3 className="flex min-w-0 items-center text-sm font-semibold uppercase tracking-widest text-gray-300">
          Human call forwarding
          <InfoTooltip width={300}>
            When a caller asks for a person, the assistant works out what the
            call is about and hands it to the matching person — it never sees or
            says these numbers. A request with no match falls back to the
            Other / General person. There are four forwarding slots; this is
            separate from your Vobiz numbers and SIP trunks, so saving here does
            not change them.
          </InfoTooltip>
        </h3>
        <button
          type="button"
          onClick={addPerson}
          disabled={nextFree === -1}
          title={
            nextFree === -1
              ? "All four forwarding slots are in use"
              : "Add another person"
          }
          aria-label="Add New"
          className="inline-flex shrink-0 items-center rounded-md border border-white/10 bg-white/[0.03] p-1 text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} />
          <span className="sr-only">Add New</span>
        </button>
      </div>

      {/* <details> rather than conditional rendering: a collapsed section must
          still SUBMIT. <details> keeps its children mounted (they are merely
          hidden), so the phone/enabled/label/priority inputs are always in the
          form payload. Open by default; the operator can fold it away. */}
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[10px] text-gray-400 transition hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40">
          <ChevronRight
            size={11}
            className="shrink-0 transition-transform group-open:rotate-90"
          />
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              !anyEnabled ? "bg-gray-500" : otherReady ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          <span className="font-medium text-gray-300">
            {shown.filter((r) => r.enabled && r.phone).length} enabled
          </span>
          <span className="text-gray-600">
            · {shown.length}/{rows.length} slot{shown.length === 1 ? "" : "s"}
          </span>
        </summary>

        <div className="mt-1 space-y-0.5">
        {rows.map((r, i) => {
          // Person numbering follows the visible order of configured slots.
          const personNo = rows.slice(0, i + 1).filter((x) => x.present).length;
          const bad = r.phone.length > 0 && !E164_RE.test(r.phone.trim());
          const enabledNoPhone = r.enabled && !r.phone.trim();

          // A slot the operator has not added stays out of the DOM entirely,
          // except for the hidden priority carrier below, so an existing stored
          // priority can never be rewritten by this form.
          if (!r.present) {
            return (
              <input
                key={r.category}
                type="hidden"
                name={`transfer_${r.category}_priority`}
                value={r.priority}
              />
            );
          }

          return (
            <div
              key={r.category}
              className="rounded-md border border-white/10 bg-white/[0.02] px-1 py-[2px]"
            >
              <div className="flex flex-wrap items-center gap-1">
                {/* Name only. The role/intent text was removed from the UI on
                    request; the category it maps to is unchanged and still
                    travels in the hidden label input below, so transfer
                    routing and the Other/General fallback are untouched. */}
                {/* The phone field carries min-w-0 (it used to be
                    min-w-[160px]), which is what stopped this row breaking
                    onto two lines at a ~340px column — that wrap was why the
                    card measured 415px at 1280 but 287px at 1600. flex-wrap
                    stays so an absurdly narrow container wraps instead of
                    overflowing horizontally. */}
                <div
                  className="w-6 shrink-0 text-[10px] font-medium text-gray-400"
                  title={`Person ${personNo}`}
                >
                  P{personNo}
                </div>

                <label className="min-w-0 flex-1">
                  <span className="sr-only">Person {personNo} phone number</span>
                  <input
                    name={`transfer_${r.category}_phone`}
                    value={r.phone}
                    onChange={(e) => set(i, { phone: e.target.value })}
                    placeholder="+919876543210"
                    inputMode="tel"
                    aria-invalid={bad || undefined}
                    className={`${compactInputCls} ${bad ? "border-red-500/50" : ""}`}
                  />
                </label>

                <label
                  title={`Person ${personNo} enabled`}
                  className="flex shrink-0 cursor-pointer items-center text-[10px] text-gray-400"
                >
                  <input
                    type="checkbox"
                    name={`transfer_${r.category}_enabled`}
                    checked={r.enabled}
                    onChange={(e) => set(i, { enabled: e.target.checked })}
                    aria-label={`Person ${personNo} enabled`}
                    className="accent-violet-400"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => removePerson(i)}
                  title={`Remove Person ${personNo}`}
                  aria-label={`Remove Person ${personNo}`}
                  className="rounded-md p-1 text-gray-500 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                >
                  <X size={14} />
                </button>

                {/* Unchecked boxes are not submitted, so the label travels in a
                    hidden field either way. */}
                <input type="hidden" name={`transfer_${r.category}_label`} value={r.label} />
                {/* Priority is no longer editable here, but the server action
                    reads it and would fall back to 100 if it were absent —
                    which would silently reorder the worker's
                    `ORDER BY priority ASC` resolution. Submitting the stored
                    value keeps routing exactly as it is. */}
                <input type="hidden" name={`transfer_${r.category}_priority`} value={r.priority} />
              </div>

              {bad && (
                <p className="callout-bad mt-1.5 flex items-start gap-1.5 rounded-lg p-1.5 text-[11px]">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Use E.164 format — a plus, country code, then the number, e.g.
                  +919876543210.
                </p>
              )}
              {enabledNoPhone && !bad && (
                <p className="callout-warn mt-1.5 flex items-start gap-1.5 rounded-lg p-1.5 text-[11px]">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  Enabled but no number — add one, or switch it off.
                </p>
              )}
            </div>
          );
        })}
        </div>
      </details>

      {shown.length === 0 && (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] p-2 text-[11px] text-gray-500">
          No people configured — use <strong>Add New</strong>.
        </p>
      )}

    </section>
  );
}
