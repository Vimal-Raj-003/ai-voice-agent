"use client";

// Themed dropdown that replaces browser-native <select>. The native version
// rendered with the OS theme (white-on-white in this app's dark scheme) and
// couldn't be styled. This one renders the popover with the same glass +
// gradient vocabulary as the rest of the dashboard, and emits a hidden
// <input> so Server Actions consuming FormData still see the value.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

type Props = {
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  onChange?: (value: string) => void;
};

export default function Select({
  name,
  options,
  defaultValue,
  placeholder = "— Select —",
  disabled,
  required,
  className,
  onChange,
}: Props) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-sync local state if the parent re-renders with a different defaultValue
  // (e.g. router navigation, controlled-style usage). Without this the Select
  // silently keeps its first value forever even though the prop says otherwise.
  useEffect(() => {
    setValue(defaultValue ?? "");
  }, [defaultValue]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const display = selected?.label ?? placeholder;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      {/* Hidden real input so FormData picks the value up server-side. */}
      <input type="hidden" name={name} value={value} required={required} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-left transition hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-50 ${
          selected ? "" : "text-gray-500"
        }`}
      >
        <span className="truncate">{display}</span>
        <ChevronsUpDown
          size={14}
          className={`shrink-0 text-gray-500 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        // Solid background — `glass-strong` was too translucent, content from
        // sections below showed through the dropdown panel. We keep the
        // gradient ring / blur effect on cards, but for popovers opacity must
        // be near-100% so option text is the only thing the eye reads.
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-xl border border-white/10 bg-[#0b0d20] py-1 max-h-60 overflow-y-auto shadow-[0_24px_48px_-12px_rgba(0,0,0,0.7),0_0_0_1px_rgba(167,139,250,0.15)] backdrop-blur-xl"
          style={{ backgroundColor: "rgba(11, 13, 32, 0.97)" }}
        >
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">No options</div>
          )}
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setValue(opt.value);
                  onChange?.(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-start justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                  isSelected
                    ? "bg-violet-500/[0.12] text-white"
                    : "text-gray-200 hover:bg-white/[0.04]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.description && (
                    <span className="block text-[10px] text-gray-500">
                      {opt.description}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <Check size={14} className="shrink-0 text-cyan-300 mt-0.5" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
