"use client";

import { useState, useTransition } from "react";
import { Plus, X, Loader2, Check, AlertCircle, Video, Copy, ExternalLink } from "lucide-react";
import {
  createBooking,
  type CreateBookingResult,
} from "@/app/(admin)/calendar/actions";
import FormField from "@/components/FormField";

const inputCls =
  "w-full rounded-xl border border-white/15 bg-slate-900/80 px-3 py-2.5 text-base sm:text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-400/50";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

export default function BookingForm({
  defaultDate,
  hosts = [],
}: {
  defaultDate?: string;
  hosts?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CreateBookingResult | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setResult(null);
    start(async () => {
      const r = await createBooking(fd);
      setResult(r);
      if (r.ok) {
        formEl.reset();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-xl bg-teal-400 hover:bg-teal-300 px-4 py-2.5 text-xs sm:text-sm font-bold text-teal-950 shadow-[0_8px_22px_rgba(20,184,166,0.28)] transition cursor-pointer"
      >
        <Plus size={15} /> Schedule Meeting
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-teal-400/25 bg-[#111c30] p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-300">
                  <Video size={18} />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    Schedule Cal.com Meeting
                  </h3>
                  <p className="text-xs text-slate-400">
                    Syncs with Cal.com &amp; generates an instant video meeting link
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-gray-400 hover:bg-white/10 hover:text-white cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {result?.ok === true && (
              <div className="mb-4 rounded-xl border border-emerald-400/35 bg-emerald-500/10 p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-emerald-300">
                  <Check size={15} />
                  <span>
                    Meeting Booked ({result.bookingId})
                    {result.calcomUid ? " • Synced to Cal.com" : ""}
                  </span>
                </div>
                {result.meetingUrl && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/60 border border-white/10 px-3 py-2">
                    <a
                      href={result.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-300 hover:underline truncate"
                    >
                      <Video size={13} />
                      <span className="truncate">{result.meetingUrl}</span>
                      <ExternalLink size={11} />
                    </a>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(result.meetingUrl!);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-teal-400 px-2.5 py-1 text-[11px] font-bold text-teal-950 cursor-pointer"
                    >
                      <Copy size={11} />
                      <span>{copied ? "Copied!" : "Copy Link"}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {result?.ok === false && (
              <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/15 p-3 text-xs text-rose-200 flex items-start gap-2">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{result.error}</span>
              </div>
            )}

            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Attendee Name" tooltip="Customer or client full name.">
                  <input name="name" required placeholder="Arun Kumar" className={inputCls} />
                </FormField>
                <FormField label="Phone (E.164)" tooltip="Include country code, e.g. +919876543210">
                  <input
                    name="phone"
                    required
                    defaultValue="+91"
                    placeholder="+919876543210"
                    className={inputCls + " font-mono"}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Date" tooltip="Meeting date (YYYY-MM-DD).">
                  <input
                    type="date"
                    name="date"
                    required
                    defaultValue={defaultDate}
                    className={inputCls}
                  />
                </FormField>
                <FormField label="Time (24h)" tooltip="Meeting start time.">
                  <input
                    type="time"
                    name="time"
                    required
                    defaultValue="11:00"
                    className={inputCls}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Attendee Email" tooltip="Meeting invite & confirmation link recipient.">
                  <input
                    type="email"
                    name="email"
                    placeholder="client@company.com"
                    className={inputCls}
                  />
                </FormField>
                <FormField label="Duration (minutes)" tooltip="Meeting length in minutes.">
                  <input
                    type="number"
                    name="durationMinutes"
                    min={10}
                    max={240}
                    step={5}
                    defaultValue={30}
                    className={inputCls}
                  />
                </FormField>
              </div>

              <FormField label="Meeting Title / Service" tooltip="Topic or consultation type.">
                <input
                  name="service"
                  required
                  placeholder="Product Demo & Consultation"
                  className={inputCls}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Host (optional)" tooltip="Assigned team member.">
                  <input
                    name="host"
                    list="booking-hosts"
                    placeholder="Host name"
                    className={inputCls}
                  />
                  <datalist id="booking-hosts">
                    {hosts.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </FormField>
                <FormField label="Timezone" tooltip="Meeting timezone.">
                  <select name="timezone" defaultValue="Asia/Kolkata" className={inputCls}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <input type="hidden" name="status" value="BOOKED" />

              <FormField label="Agenda / Notes (optional)" tooltip="Optional meeting agenda.">
                <input name="notes" placeholder="Agenda or special notes..." className={inputCls} />
              </FormField>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-semibold text-gray-300 hover:bg-white/5 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-400 hover:bg-teal-300 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-teal-950 disabled:opacity-50 transition cursor-pointer"
                >
                  {pending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Booking &amp; Generating Link…
                    </>
                  ) : (
                    <>
                      <Video size={14} /> Confirm &amp; Generate Link
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
