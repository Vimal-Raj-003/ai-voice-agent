"use client";

import { useActionState, useState } from "react";
import { Phone, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  quickDispatchAction,
  type QuickDispatchResult,
} from "@/app/(admin)/_actions/quick-dispatch";

export default function QuickDispatch() {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState<
    QuickDispatchResult | null,
    FormData
  >(quickDispatchAction, null);

  return (
    <div className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-blue-500/10 p-3">
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
          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
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
