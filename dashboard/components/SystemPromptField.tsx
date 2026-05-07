"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, X, AlertCircle } from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import { generatePromptAction } from "@/app/(admin)/assistants/_actions/generate-prompt";

// Replaces the plain System Prompt textarea on AssistantForm. The textarea
// itself is controlled here (so the AI generator can populate it
// programmatically), and a name="systemPrompt" attribute keeps the existing
// Server Action FormData contract intact.
export default function SystemPromptField({
  defaultValue = "",
  rows = 14,
}: {
  defaultValue?: string;
  rows?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const [genOpen, setGenOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
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
          onClick={() => {
            setGenOpen((v) => !v);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/30 bg-violet-500/[0.08] px-2.5 py-1 text-[11px] text-violet-200 hover:bg-violet-500/[0.14] transition"
        >
          <Sparkles size={11} />
          {genOpen ? "Hide AI generator" : "Generate with AI"}
        </button>
      </div>

      {genOpen && (
        <div className="mb-2 rounded-xl border border-violet-400/30 bg-violet-500/[0.04] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-violet-200/80">
              Describe the assistant
            </span>
            <button
              type="button"
              onClick={() => setGenOpen(false)}
              className="text-gray-500 hover:text-white"
              aria-label="Close generator"
            >
              <X size={12} />
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="A friendly receptionist for a dental clinic that books appointments, takes messages, and transfers urgent calls to a human."
            className={inputCls}
            disabled={pending}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={pending || !description.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-3 py-1.5 text-[11px] font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 disabled:opacity-50 transition"
            >
              {pending ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles size={11} /> Generate prompt
                </>
              )}
            </button>
            <span className="text-[10px] text-gray-500">
              Replaces the current prompt below.
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

      <textarea
        name="systemPrompt"
        rows={rows}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="You are Priya, a friendly receptionist who…"
        className={inputCls + " font-mono resize-y"}
      />
    </div>
  );
}
