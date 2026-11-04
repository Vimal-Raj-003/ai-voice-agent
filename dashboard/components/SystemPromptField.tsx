"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles, Loader2, X, AlertCircle, Pencil } from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import { generatePromptAction } from "@/app/(admin)/assistants/_actions/generate-prompt";
import type { PromptDirection } from "@/lib/assistant-prompts";

// System prompt field: a short preview in the form, with the full editor in a
// dialog.
//
// The 14-row textarea used to sit inline and was the single tallest thing on
// the page — it alone made Identity the tallest column and pushed everything
// below it off-screen. Long-form editing is also the one task here that
// genuinely wants protected focus, so a dialog is the right container rather
// than decoration.
//
// Each direction stays in its own draft. Hidden inputs submit both even when
// the editor is closed or the other direction is selected.
export default function SystemPromptField({
  defaultValue = "",
  defaultOutboundValue = defaultValue,
  rows = 14,
}: {
  defaultValue?: string;
  defaultOutboundValue?: string;
  rows?: number;
}) {
  const [direction, setDirection] = useState<PromptDirection>("INBOUND");
  const [values, setValues] = useState({ INBOUND: defaultValue, OUTBOUND: defaultOutboundValue });
  const value = values[direction];
  const directionLabel = direction === "INBOUND" ? "Inbound" : "Outbound";
  const [open, setOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [descriptions, setDescriptions] = useState({ INBOUND: "", OUTBOUND: "" });
  const description = descriptions[direction];
  const [generated, setGenerated] = useState<{ direction: PromptDirection; prompt: string } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const inputCls =
    "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

  const handleGenerate = () => {
    setError(null);
    const target = direction;
    start(async () => {
      const r = await generatePromptAction(description, target);
      if (r.ok) {
        setGenerated({ direction: target, prompt: r.prompt });
      } else {
        setError(r.error);
      }
    });
  };

  // Escape closes the dialog; focus moves into the editor when it opens.
  useEffect(() => {
    if (!open) return;
    areaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  const editor = (
    <>
      {genOpen && (
        <div className="max-h-[45vh] shrink-0 overflow-y-auto rounded-xl border border-violet-400/30 bg-violet-500/[0.04] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-violet-200/80">
              Describe the {directionLabel.toLowerCase()} assistant
            </span>
            <button
              type="button"
              onClick={() => setGenOpen(false)}
              aria-label="Close generator"
              className="text-gray-500 hover:text-white"
            >
              <X size={13} />
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescriptions((previous) => ({ ...previous, [direction]: e.target.value }))}
            maxLength={2000}
            aria-label={`${directionLabel} assistant description`}
            rows={3}
            placeholder="A warm receptionist for a dental clinic who books appointments…"
            className={inputCls}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={pending || !description.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/30 bg-violet-500/[0.12] px-2.5 py-1 text-[11px] font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {pending ? "Generating…" : "Generate"}
            </button>
            <span className="text-[10px] text-gray-500">
              Preview first, then apply to the {directionLabel.toLowerCase()} prompt only.
            </span>
          </div>
          {error && (
            <div role="alert" className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
              <AlertCircle size={11} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          {generated?.direction === direction && (
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="block text-xs text-gray-300">
                Generated {directionLabel.toLowerCase()} prompt
                <textarea readOnly value={generated.prompt} rows={7} className={inputCls + " mt-2 font-mono text-xs"} />
              </label>
              <button type="button" onClick={() => {
                setValues((previous) => ({ ...previous, [generated.direction]: generated.prompt }));
                setGenerated(null);
                setGenOpen(false);
              }} className="rounded-md border border-violet-400/30 bg-violet-500/20 px-3 py-1.5 text-xs text-violet-200">
                Use {directionLabel.toLowerCase()} prompt
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div>
      <input type="hidden" name="systemPrompt" value={values.INBOUND} />
      <input type="hidden" name="outboundSystemPrompt" value={values.OUTBOUND} />
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center text-[10px] uppercase tracking-widest text-gray-400">
          System prompt
          <InfoTooltip>
            What the AI follows during the call. The hallucination guard, if
            enabled, automatically appends a &quot;don&apos;t invent
            information&quot; clause to whatever you write here.
            Inbound and outbound prompts are saved separately. A blank outbound
            prompt uses the inbound prompt.
          </InfoTooltip>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
        >
          <Pencil size={11} /> Edit prompt
        </button>
      </div>

      {/* Preview: enough to recognise the prompt, not enough to dominate. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left transition hover:border-violet-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
      >
        {value.trim() ? (
          <>
            <span className="line-clamp-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-400">
              {value}
            </span>
            <span className="mt-1 block text-[10px] text-gray-600">
              {directionLabel} · {words.toLocaleString()} words · click to edit
            </span>
          </>
        ) : (
          <span className="block text-[11px] text-gray-600">
            No prompt yet — click to write one, or generate it with AI.
          </span>
        )}
      </button>

      <div
        className={
          open
            ? "modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6"
            : "hidden"
        }
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Edit system prompt" : undefined}
        onMouseDown={(e) => {
          // Backdrop click closes; clicks inside the panel must not.
          if (open && e.target === e.currentTarget) setOpen(false);
        }}
      >
        {/* Long prompts are edited here, so the panel takes most of the
            viewport (90vw x 85vh, capped on very wide screens) and lays out as
            a flex column: header and footer keep their natural height and the
            textarea absorbs everything left over. */}
        <div className="modal-surface flex h-[85vh] w-[90vw] max-w-[1800px] flex-col gap-3 overflow-y-auto rounded-2xl p-5">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              System prompt
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setGenOpen((v) => !v);
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/30 bg-violet-500/[0.08] px-2.5 py-1 text-[11px] text-violet-200 transition hover:bg-violet-500/[0.14]"
              >
                <Sparkles size={11} />
                {genOpen ? "Hide AI generator" : "Generate with AI"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close editor"
                className="rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div role="group" aria-label="System prompt call direction" className="flex shrink-0 gap-1 self-start rounded-lg border border-white/10 bg-black/20 p-1">
            {(["INBOUND", "OUTBOUND"] as const).map((item) => (
              <button type="button" key={item} aria-pressed={direction === item} onClick={() => { setDirection(item); setError(null); }}
                className={`rounded-md px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${direction === item ? "bg-violet-500/20 text-violet-200" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}>
                {item === "INBOUND" ? "Inbound" : "Outbound"}
              </button>
            ))}
          </div>

          {editor}

          <textarea
            ref={areaRef}
            aria-label={`${directionLabel} system prompt`}
            rows={rows}
            value={value}
            onChange={(e) => setValues((previous) => ({ ...previous, [direction]: e.target.value }))}
            placeholder="You are Priya, a friendly receptionist who…"
            // min-h-0 is what lets a flex child actually shrink/scroll inside
            // the column instead of forcing the panel taller than the viewport.
            className={inputCls + " min-h-0 flex-1 resize-none font-mono text-[13px] leading-relaxed"}
          />

          <div className="flex shrink-0 items-center justify-between gap-3">
            <span className="text-[10px] text-gray-500">
              Changes apply when you save the assistant — closing this editor
              keeps them.
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
