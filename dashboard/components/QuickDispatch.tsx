"use client";

import { useActionState, useState } from "react";
import { Phone, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  quickDispatchAction,
  type QuickDispatchResult,
} from "@/app/(admin)/_actions/quick-dispatch";
import { LANGUAGE_PRESETS } from "@/lib/language-presets";
import Select from "./Select";

export default function QuickDispatch() {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState<
    QuickDispatchResult | null,
    FormData
  >(quickDispatchAction, null);

  return (
    <div className="ring-gradient rounded-xl bg-gradient-to-br from-violet-500/[0.08] via-fuchsia-500/[0.04] to-cyan-500/[0.08] p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Phone size={14} className="text-purple-300" /> Quick dispatch
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <form action={formAction} className="mt-3 space-y-2">
          <input
            name="phone"
            placeholder="+919876543210"
            required
            className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
          />
          <input
            name="lead_name"
            placeholder="Lead name (optional)"
            className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
          />
          <Select
            name="language_preset"
            defaultValue="hinglish"
            options={LANGUAGE_PRESETS.map((p) => ({
              value: p.id,
              label: p.label,
            }))}
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-2 py-1.5 text-xs font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 disabled:opacity-50 transition shadow-[0_0_20px_rgba(167,139,250,0.3)]"
          >
            {pending && <Loader2 size={12} className="animate-spin" />}
            {pending ? "Dispatching…" : "Place call"}
          </button>

          {state?.ok === true && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300">
              Dispatched · room {state.room.slice(0, 16)}…
            </div>
          )}
          {state?.ok === false && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 break-words">
              {state.error}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
