"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  ChevronLeft,
  Video,
  Copy,
  Check,
  Phone,
  Mail,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/Badge";
import BookingRowActions from "./BookingRowActions";

type Appt = {
  id: string;
  bookingId: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  date: string;
  time: string;
  service: string;
  status: string;
  notes?: string | null;
  durationMinutes?: number;
  host?: string | null;
  calcomBookingUid?: string | null;
  gcalEventId?: string | null;
};

function statusTone(s: string) {
  if (s === "BOOKED") return "success" as const;
  if (s === "CANCELLED" || s === "NO_SHOW") return "danger" as const;
  if (s === "COMPLETED") return "info" as const;
  return "neutral" as const;
}

function resolveMeetingUrl(a: Appt): string {
  if (a.notes) {
    const m = a.notes.match(/\[MEETING_URL:([^\]]+)\]/);
    if (m && m[1]) return m[1].trim();
  }
  if (a.calcomBookingUid) {
    return `https://app.cal.com/video/${a.calcomBookingUid}`;
  }
  return `https://meet.jit.si/JillJill-${a.bookingId}`;
}

function cleanUserNotes(notes?: string | null): string {
  if (!notes) return "";
  return notes.replace(/\[MEETING_URL:[^\]]+\]\s*/g, "").trim();
}

export default function DayDrawer({
  day,
  appts,
  allMonthAppts,
  monthLabel,
  statusFilter,
}: {
  day: string | null;
  appts: Appt[];
  allMonthAppts?: Appt[];
  monthLabel?: string;
  statusFilter?: string;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isMonthOverview = !day;
  const list = isMonthOverview ? (allMonthAppts ?? appts) : appts;

  const heading = day
    ? new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : statusFilter
    ? `${statusFilter} Meetings · ${monthLabel ?? ""}`
    : `Scheduled Meetings · ${monthLabel ?? ""}`;

  const copyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3.5 gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            {heading}
          </h2>
          {day && (
            <Link
              href="/calendar"
              className="inline-flex items-center gap-1 text-[11px] text-teal-300 hover:underline mt-0.5"
            >
              <ChevronLeft size={12} /> Show all month meetings
            </Link>
          )}
        </div>
        <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-200">
          {list.length} {list.length === 1 ? "meeting" : "meetings"}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 py-10 min-h-[220px]">
          <CalendarCheck size={30} className="text-teal-400/50 mb-2.5" />
          <div className="text-sm font-semibold text-gray-300">
            {day ? "No meetings scheduled on this date." : `No meetings in ${monthLabel ?? "this month"}.`}
          </div>
          <div className="text-xs text-gray-500 mt-1 max-w-xs">
            Click &ldquo;Schedule Meeting&rdquo; above or book via your AI Voice Agent — meeting links generate automatically.
          </div>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto max-h-[620px] pr-1">
          {list.map((a) => {
            const meetUrl = resolveMeetingUrl(a);
            const noteText = cleanUserNotes(a.notes);
            const isActive = a.status === "BOOKED";

            return (
              <div
                key={a.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.05] p-3.5 transition space-y-2.5"
              >
                {/* Top Row: Time + Service + Status */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-teal-300 bg-teal-400/10 border border-teal-400/25 px-2 py-0.5 rounded-md tabular-nums">
                        <Clock size={11} />
                        {day ? a.time : `${a.date} · ${a.time}`}
                      </span>
                      <span className="text-xs text-gray-400">
                        {a.durationMinutes ?? 30}m IST
                      </span>
                      {a.calcomBookingUid && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-400/25">
                          Cal.com Synced
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-white mt-1.5">
                      {a.service} — <span className="text-teal-200">{a.name}</span>
                    </h3>
                  </div>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                </div>

                {/* Contact Info */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-300">
                  <a
                    href={`tel:${a.phoneNumber}`}
                    className="inline-flex items-center gap-1 hover:text-white font-mono"
                  >
                    <Phone size={11} className="text-gray-400" />
                    {a.phoneNumber}
                  </a>
                  {a.email && (
                    <a
                      href={`mailto:${a.email}`}
                      className="inline-flex items-center gap-1 hover:text-white truncate max-w-[220px]"
                      title={a.email}
                    >
                      <Mail size={11} className="text-gray-400" />
                      {a.email}
                    </a>
                  )}
                  <span className="text-[10.5px] font-mono text-gray-500">
                    ID: {a.bookingId}
                  </span>
                </div>

                {noteText && (
                  <p className="text-xs text-gray-400 bg-black/20 rounded-lg px-2.5 py-1.5">
                    {noteText}
                  </p>
                )}

                {/* Google Meet / Cal Video Meeting Link Bar */}
                {a.status !== "CANCELLED" && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-400/25 bg-teal-500/[0.07] px-2.5 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Video size={14} className="text-teal-300 shrink-0" />
                      <a
                        href={meetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-teal-200 hover:text-white underline underline-offset-2 truncate"
                      >
                        Join Video Meeting
                      </a>
                      <ExternalLink size={11} className="text-teal-300/70 shrink-0" />
                    </div>
                    <button
                      type="button"
                      onClick={() => copyLink(a.id, meetUrl)}
                      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] font-medium text-gray-200 cursor-pointer"
                    >
                      {copiedId === a.id ? (
                        <>
                          <Check size={11} className="text-emerald-400" />
                          <span className="text-emerald-300">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Booking Row Actions (Done / Reschedule / Cancel) */}
                {isActive && (
                  <div className="pt-1 flex justify-end">
                    <BookingRowActions
                      appointmentId={a.id}
                      status={a.status}
                      date={a.date}
                      time={a.time}
                      durationMinutes={a.durationMinutes ?? 30}
                      externallyLinked={!!(a.calcomBookingUid || a.gcalEventId)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
