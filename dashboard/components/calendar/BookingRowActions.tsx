"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Check, Loader2, X } from "lucide-react";
import {
  cancelBooking,
  markCompleted,
  rescheduleBooking,
} from "@/app/(admin)/calendar/actions";

// Per-row actions. Shown only while status === BOOKED, inline next to the
// existing status badge. Cancel was already here; reschedule and complete are
// new and reuse the same compact button styling.
export default function BookingRowActions({
  appointmentId,
  status,
  date,
  time,
  durationMinutes = 30,
  externallyLinked = false,
}: {
  appointmentId: string;
  status: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  /** Linked to Cal.com / Google — rescheduling locally would drift. */
  externallyLinked?: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "BOOKED") return null;

  const btn =
    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] disabled:opacity-50 transition";

  const doReschedule = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await rescheduleBooking(appointmentId, fd);
      if (r.ok) setOpen(false);
      else setError(r.error);
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setError(null); }}
        disabled={pending || externallyLinked}
        title={externallyLinked
          ? "Linked to an external calendar — reschedule it there"
          : "Move this booking"}
        className={`${btn} border-white/15 bg-white/[0.04] text-gray-300 hover:bg-white/[0.1] hover:text-white`}
        aria-label="Reschedule booking"
        aria-expanded={open}
      >
        <CalendarClock size={9} /> Reschedule
      </button>

      <button
        type="button"
        onClick={() => start(async () => { await markCompleted(appointmentId); })}
        disabled={pending}
        className={`${btn} border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-300 hover:bg-emerald-500/[0.12]`}
        aria-label="Mark booking completed"
      >
        {pending ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
        Done
      </button>

      <button
        type="button"
        onClick={() => start(async () => { await cancelBooking(appointmentId); })}
        disabled={pending}
        className={`${btn} border-red-500/30 bg-red-500/[0.05] text-red-300 hover:bg-red-500/[0.12]`}
        aria-label="Cancel booking"
      >
        {pending ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
        Cancel
      </button>

      {open && (
        <form
          onSubmit={doReschedule}
          className="mt-1 flex w-full flex-wrap items-end gap-1.5 rounded-lg border border-white/10 bg-black/30 p-1.5"
        >
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-gray-500">Date</span>
            <input
              type="date" name="date" required defaultValue={date}
              className="rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px]"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-gray-500">Time</span>
            <input
              type="time" name="time" required defaultValue={time}
              className="rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px]"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase tracking-widest text-gray-500">Mins</span>
            <input
              type="number" name="durationMinutes" min={5} max={480} step={5}
              defaultValue={durationMinutes}
              className="w-14 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px]"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className={`${btn} border-violet-400/30 bg-violet-500/[0.12] text-violet-100 hover:bg-violet-500/20`}
          >
            {pending ? <Loader2 size={9} className="animate-spin" /> : <CalendarClock size={9} />}
            Move
          </button>
          {error && (
            <span role="alert" className="w-full text-[10px] text-red-300">{error}</span>
          )}
        </form>
      )}
    </span>
  );
}
