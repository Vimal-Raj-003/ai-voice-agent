import Link from "next/link";
import { CalendarCheck, ChevronLeft } from "lucide-react";
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
    ? `${statusFilter} Appointments · ${monthLabel ?? ""}`
    : `All Bookings · ${monthLabel ?? ""}`;

  return (
    <div className="glass rounded-2xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-200">
            {heading}
          </h2>
          {day && allMonthAppts && allMonthAppts.length > 0 && (
            <Link
              href="/calendar"
              className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline mt-0.5"
            >
              <ChevronLeft size={12} /> Show all {statusFilter ? statusFilter.toLowerCase() : "month"} bookings
            </Link>
          )}
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300">
          {list.length} {statusFilter === "BOOKED" ? "booked" : "booking"}{list.length === 1 ? "" : "s"}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 py-12 min-h-[240px]">
          <CalendarCheck size={28} className="text-gray-600 mb-2" />
          <div className="text-sm font-medium text-gray-400">
            {day
              ? "No bookings on this day."
              : `No ${statusFilter ? statusFilter.toLowerCase() : ""} bookings in ${monthLabel ?? "this month"}.`}
          </div>
          <div className="text-[11px] text-gray-600 mt-1">
            {day
              ? "Pick another day or view all month bookings."
              : "When customers book via voice calls or manual entry, they appear here."}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto flex-1">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-gray-500">
                <th className="py-2 pr-3 font-medium">{day ? "Time" : "Date & Time"}</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Phone</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Service</th>
                <th className="py-2 pr-3 font-medium">Host</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map((a) => (
                <tr key={a.id} className="align-top hover:bg-white/[0.02] transition">
                  <td className="py-2.5 pr-3 font-medium tabular-nums whitespace-nowrap">
                    {day ? (
                      a.time
                    ) : (
                      <div>
                        <span className="font-semibold text-gray-200">{a.date}</span>
                        <span className="block text-[11px] text-gray-400">{a.time}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="whitespace-nowrap font-medium text-gray-200">{a.name}</div>
                    <div className="text-[10px] font-mono text-gray-500">
                      {a.bookingId}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                    {a.phoneNumber}
                  </td>
                  <td className="max-w-[140px] py-2.5 pr-3 font-mono text-xs text-gray-400">
                    {a.email ? (
                      <span className="block truncate text-gray-300" title={a.email}>{a.email}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-300 whitespace-nowrap">
                    {a.service}
                    {a.durationMinutes ? (
                      <span className="ml-1 text-[10px] text-gray-500">
                        {a.durationMinutes}m
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-gray-400">
                    {a.host || <span className="text-gray-600">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </td>
                  <td className="py-2.5">
                    <BookingRowActions
                      appointmentId={a.id}
                      status={a.status}
                      date={a.date}
                      time={a.time}
                      durationMinutes={a.durationMinutes ?? 30}
                      externallyLinked={!!(a.calcomBookingUid || a.gcalEventId)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
