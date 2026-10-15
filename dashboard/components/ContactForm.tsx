"use client";

import { useActionState } from "react";
import { UserPlus, Loader2, AlertCircle } from "lucide-react";
import { createContact, type CreateContactState } from "@/app/(admin)/contacts/actions";

// Light input surface with explicit DARK value text. The inline `valueStyle`
// forces the typed value dark even under browser autofill / webkit defaults
// (WebkitTextFillColor is what was making the value near-invisible before).
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50";
const valueStyle = {
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
  opacity: 1,
} as const;

function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="mb-1 block text-[10px] uppercase tracking-widest text-gray-400">
      {children}
      {optional && <span className="ml-1 normal-case tracking-normal text-gray-600">optional</span>}
    </span>
  );
}

// Address-book contact form (person/customer). Uses useActionState so a failed
// save stays on the form with the real error; a successful save redirects to
// /contacts (handled in the server action) where the new row shows immediately.
export default function ContactForm() {
  const [state, action, pending] = useActionState<CreateContactState, FormData>(createContact, null);

  return (
    <form action={action} className="glass space-y-5 rounded-2xl p-5">
      <label className="block">
        <Label>Name *</Label>
        <input name="name" required placeholder="Vimal" className={inputCls} style={valueStyle} autoComplete="off" />
      </label>

      <label className="block">
        <Label>Phone number *</Label>
        <input
          name="phone"
          required
          inputMode="tel"
          placeholder="+919876543210"
          className={inputCls + " font-mono"}
          style={valueStyle}
          autoComplete="off"
        />
        <span className="mt-1 block text-[10px] text-gray-500">E.164 format (country code + number).</span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <Label optional>Email</Label>
          <input name="email" type="email" placeholder="vimal@example.com" className={inputCls} style={valueStyle} autoComplete="off" />
        </label>
        <label className="block">
          <Label optional>Company</Label>
          <input name="company" placeholder="VIMS Enterprise" className={inputCls} style={valueStyle} autoComplete="off" />
        </label>
      </div>

      <label className="block">
        <Label optional>Tags</Label>
        <input name="tags" placeholder="vip, lead, mumbai" className={inputCls} style={valueStyle} autoComplete="off" />
        <span className="mt-1 block text-[10px] text-gray-500">Comma-separated.</span>
      </label>

      <label className="block">
        <Label optional>Notes</Label>
        <textarea name="notes" rows={3} placeholder="Anything useful about this contact…" className={inputCls} style={valueStyle} />
      </label>

      {state?.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <button
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_20px_rgba(167,139,250,0.25)] transition hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 disabled:opacity-50"
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
        {pending ? "Saving…" : "Save contact"}
      </button>
    </form>
  );
}
