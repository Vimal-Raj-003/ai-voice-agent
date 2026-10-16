import { CalendarCheck } from "lucide-react";
import { Badge } from "@/components/Badge";
import BookingRowActions from "./BookingRowActions";

// Mirrors the Appointment columns the Calendar page selects. `email` is now
// surfaced (voice bookings and the manual form both may set it).
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
}: {
  day: string | null;
  appts: Appt[];
}) {
  if (!day) {
    return (
      <div className="glass rounded-2xl p-5 h-full flex flex-col items-center justify-center text-center text-gray-500 min-h-[280px]">
        <CalendarCheck size={28} className="text-gray-600 mb-2" />
        <div className="text-sm">Pick a day to see bookings.</div>
        <div className="text-[11px] text-gray-600 mt-1">
          Days with bookings show a count.
        </div>
      </div>
    );
  }
  const heading = new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          {heading}
        </h2>
        <span className="text-[10px] font-mono text-gray-500">
          {appts.length} booking{appts.length === 1 ? "" : "s"}
        </span>
      </div>
      {appts.length === 0 ? (
        <p className="text-sm text-gray-500">No bookings on this day.</p>
      ) : (
        // Clean appointment table: Time · Customer · Phone · Email · Service ·
        // Status · Actions. Appointments are already ordered by time (page
        // query). Horizontal scroll keeps all columns readable in the drawer.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-gray-500">
                <th className="py-2 pr-3 font-medium">Time</th>
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
              {appts.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="py-2.5 pr-3 font-medium tabular-nums whitespace-nowrap">
                    {a.time}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="whitespace-nowrap">{a.name}</div>
                    <div className="text-[10px] font-mono text-gray-600">
                      {a.bookingId}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                    {a.phoneNumber}
                  </td>
                  <td className="max-w-[140px] py-2.5 pr-3 font-mono text-xs text-gray-400">
                    {a.email ? (
                      <span className="block truncate" title={a.email}>{a.email}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-300 whitespace-nowrap">
                    {a.service}
                    {a.durationMinutes ? (
                      <span className="ml-1 text-[10px] text-gray-600">
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
