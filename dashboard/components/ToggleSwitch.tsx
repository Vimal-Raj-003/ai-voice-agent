"use client";

import { useId, useState } from "react";
import InfoTooltip from "./InfoTooltip";

/**
 * Compact ON/OFF switch for a binary assistant setting.
 *
 * FORM CONTRACT — deliberately unchanged from the BooleanSelect it replaces.
 * The server action parses these with
 *   `_bool(v) => v === "true" || v === "on"`
 * so a native checkbox carrying `value="true"` round-trips exactly:
 *   checked   -> FormData has "true"  -> true
 *   unchecked -> the browser omits the field entirely -> _bool(null) -> false
 * No hidden companion input is used: `formData.get()` returns the FIRST entry,
 * so a hidden "false" placed before the checkbox would win and the setting
 * could never be turned on.
 *
 * It stays a real <input type="checkbox">, so the Space key, form reset, and
 * autofill all behave natively; `role="switch"` is the ARIA-correct role for a
 * checkbox presented as an on/off switch, and aria-checked is implicit. Enter
 * is handled explicitly because a checkbox would otherwise submit the form —
 * the brief asks for Space AND Enter.
 */
export default function ToggleSwitch({
  name,
  label,
  tooltip,
  defaultChecked,
}: {
  name: string;
  label: string;
  tooltip?: string;
  defaultChecked: boolean;
}) {
  // Local state drives only the visual knob; the checkbox remains the single
  // source of truth that the form submits, so there is no duplicate state.
  const [on, setOn] = useState(defaultChecked);
  const id = useId();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <label
        htmlFor={id}
        className="flex min-w-0 cursor-pointer items-center text-[10px] uppercase tracking-widest text-gray-400"
      >
        <span className="truncate">{label}</span>
        {tooltip ? <InfoTooltip>{tooltip}</InfoTooltip> : null}
      </label>

      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          name={name}
          value="true"
          defaultChecked={defaultChecked}
          onChange={(e) => setOn(e.target.checked)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Without this a checkbox submits the form instead of toggling.
              e.preventDefault();
              const el = e.currentTarget;
              el.checked = !el.checked;
              setOn(el.checked);
            }
          }}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
        />
        {/* Track */}
        <span
          aria-hidden="true"
          className={`block h-5 w-9 rounded-full transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-500/60 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-transparent ${
            on ? "bg-violet-500" : "bg-white/15"
          }`}
        />
        {/* Knob */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-0.5 left-0.5 block size-4 rounded-full bg-white shadow transition-transform duration-150 ${
            on ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </div>
  );
}
