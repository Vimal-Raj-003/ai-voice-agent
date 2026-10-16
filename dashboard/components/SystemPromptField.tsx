"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles, Loader2, X, AlertCircle, Pencil } from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import { generatePromptAction } from "@/app/(admin)/assistants/_actions/generate-prompt";

// System prompt field: a short preview in the form, with the full editor in a
// dialog.
//
// The 14-row textarea used to sit inline and was the single tallest thing on
// the page — it alone made Identity the tallest column and pushed everything
// below it off-screen. Long-form editing is also the one task here that
// genuinely wants protected focus, so a dialog is the right container rather
// than decoration.
//
// IMPORTANT — the textarea is mounted exactly ONCE and is never unmounted; only
// its wrapper switches between `hidden` and the dialog panel. A hidden form
// control still submits (only a disabled one does not), so:
//   * the value is always in the FormData under name="systemPrompt",
//   * closing the dialog cannot lose an edit,
//   * nothing is written to the backend until the form's own Save runs.
// The server-action contract and the AI generator are unchanged.
export default function SystemPromptField({
  defaultValue = "",
  rows = 14,
}: {
  defaultValue?: string;
  rows?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const inputCls =
    "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

  const handleGenerate = () => {
    setError(null);
    start(async () => {
      const r = await generatePromptAction(description);
      if (r.ok) {
        setValue(r.prompt);
        setGenOpen(false);
        setDescription("");
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
        <div className="rounded-xl border border-violet-400/30 bg-violet-500/[0.04] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-violet-200/80">
              Describe the assistant
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
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="A warm receptionist for a dental clinic who books appointments…"
            className={inputCls}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={pending || !description.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/30 bg-violet-500/[0.12] px-2.5 py-1 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {pending ? "Generating…" : "Generate"}
            </button>
            <span className="text-[10px] text-gray-500">
              Replaces the current prompt.
            </span>
          </div>
          {error && (
            <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
              <AlertCircle size={11} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center text-[10px] uppercase tracking-widest text-gray-400">
          System prompt
          <InfoTooltip>
            What the AI follows during the call. The hallucination guard, if
            enabled, automatically appends a &quot;don&apos;t invent
            information&quot; clause to whatever you write here.
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
              {words.toLocaleString()} words · click to edit
            </span>
          </>
        ) : (
          <span className="block text-[11px] text-gray-600">
            No prompt yet — click to write one, or generate it with AI.
          </span>
        )}
      </button>

      {/* The ONE textarea. Hidden while the dialog is closed, so its value stays
          in the form payload either way. */}
      <div
        className={
          open
            ? "fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
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
        <div className="flex h-[85vh] w-[90vw] max-w-[1800px] flex-col gap-3 rounded-2xl border border-white/10 bg-[#0d0f1a] p-5 shadow-2xl">
          <div className="flex shrink-0 items-center justify-between gap-3">
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

          {editor}

          <textarea
            ref={areaRef}
            name="systemPrompt"
            rows={rows}
            value={value}
            onChange={(e) => setValue(e.target.value)}
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
