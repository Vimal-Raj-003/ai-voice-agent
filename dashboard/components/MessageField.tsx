"use client";

// A spoken message, shown as ONE settings row: label on the left, a truncated
// preview on the right, full editing in a dialog.
//
// WHY: the Privacy & messages card held two multi-row textareas (rows={2} and
// rows={3}). Measured, those two controls alone were ~150px of the card's
// 333px, for two fields that hold a single sentence each and are edited once.
// A row is ~34px and reads like a settings list, which is what this is.
//
// The textarea is mounted exactly ONCE and never unmounted — only its wrapper
// switches between `hidden` and the dialog panel. A hidden form control still
// submits (only a disabled one does not), so the value is always in the
// FormData under its own name, closing the dialog cannot lose an edit, and
// nothing is written until the form's own Save runs. Same contract as
// SystemPromptField.
import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import InfoTooltip from "./InfoTooltip";

export default function MessageField({
  name,
  label,
  tooltip,
  defaultValue = "",
  placeholder,
  rows = 4,
}: {
  name: string;
  label: string;
  tooltip?: React.ReactNode;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    areaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <span className="flex shrink-0 items-center text-[10px] uppercase tracking-widest text-gray-400">
        {label}
        {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${label}`}
        className="group flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 rounded"
      >
        <span
          className={`min-w-0 truncate text-[11px] ${
            value.trim() ? "text-gray-300" : "italic text-gray-600"
          }`}
        >
          {value.trim() || "Not set"}
        </span>
        <Pencil
          size={11}
          className="shrink-0 text-gray-500 transition group-hover:text-violet-300"
        />
      </button>

      {/* The ONE textarea. Hidden while the dialog is closed, so its value
          stays in the form payload either way. */}
      <div
        className={
          open
            ? "fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
            : "hidden"
        }
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? label : undefined}
        onMouseDown={(e) => {
          if (open && e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="my-16 w-full max-w-xl space-y-3 rounded-2xl border border-white/10 bg-[#0d0f1a] p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              {label}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close editor"
              className="rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          {tooltip && <p className="text-[11px] leading-snug text-gray-500">{tooltip}</p>}
          <textarea
            ref={areaRef}
            name={name}
            rows={rows}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-gray-500">
              Changes apply when you save the assistant — closing this keeps them.
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
