"use client";

import { useState, useTransition } from "react";
import { Plus, X, Loader2, Check, AlertCircle } from "lucide-react";
import {
  createBooking,
  type CreateBookingResult,
} from "@/app/(admin)/calendar/actions";
import FormField from "@/components/FormField";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

export default function BookingForm({ defaultDate }: { defaultDate?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CreateBookingResult | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setResult(null);
    start(async () => {
      const r = await createBooking(fd);
      setResult(r);
      if (r.ok && e.currentTarget) {
        e.currentTarget.reset();
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-3 py-1.5 text-xs font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 transition shadow-[0_0_20px_rgba(167,139,250,0.25)]"
      >
        <Plus size={12} /> Add booking
      </button>
    );
  }

  return (
    <div className="glass-strong rounded-2xl p-5 max-w-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          New booking
        </h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="text-gray-500 hover:text-white"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField
            label="Name"
            tooltip="Caller's name. Stored on the contact too."
          >
            <input name="name" required placeholder="Jane Doe" className={inputCls} />
          </FormField>
          <FormField
            label="Phone (E.164)"
            tooltip="Country code + number, no spaces. e.g. +919876543210."
          >
            <input
              name="phone"
              required
              placeholder="+919876543210"
              className={inputCls + " font-mono"}
            />
          </FormField>
          <FormField
            label="Date"
            tooltip="YYYY-MM-DD. The day field on the appointment row."
          >
            <input
              type="date"
              name="date"
              required
              defaultValue={defaultDate}
              className={inputCls}
            />
          </FormField>
          <FormField
            label="Time (HH:MM)"
            tooltip="24-hour clock in your local timezone."
          >
            <input
              type="time"
              name="time"
              required
              defaultValue="10:00"
              className={inputCls}
            />
          </FormField>
        </div>
        <FormField
          label="Service"
          tooltip="Free-text — what the appointment is for. e.g. consultation, root canal, demo call."
        >
          <input
            name="service"
            required
            placeholder="consultation"
            className={inputCls}
          />
        </FormField>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-3 py-1.5 text-xs font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 disabled:opacity-50 transition"
          >
            {pending ? (
              <>
                <Loader2 size={11} className="animate-spin" /> Saving…
              </>
            ) : (
              "Create booking"
            )}
          </button>
          {result?.ok === true && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
              <Check size={11} /> {result.bookingId} created
            </span>
          )}
          {result?.ok === false && (
            <span className="inline-flex items-center gap-1 text-[11px] text-red-300">
              <AlertCircle size={11} /> {result.error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
