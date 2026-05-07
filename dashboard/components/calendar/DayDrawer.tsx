import { CalendarCheck, Clock } from "lucide-react";
import { Badge } from "@/components/Badge";
import BookingRowActions from "./BookingRowActions";

type Appt = {
  id: string;
  bookingId: string;
  name: string;
  phoneNumber: string;
  date: string;
  time: string;
  service: string;
  status: string;
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
        <ul className="space-y-2">
          {appts.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
            >
              <div className="flex items-center justify-between mb-1 gap-2">
                <span className="font-medium tabular-nums flex items-center gap-1.5">
                  <Clock size={12} className="text-cyan-300" />
                  {a.time}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  <BookingRowActions
                    appointmentId={a.id}
                    status={a.status}
                  />
                </div>
              </div>
              <div className="text-sm">{a.name}</div>
              <div className="text-xs text-gray-500 font-mono">
                {a.phoneNumber} · {a.service}
              </div>
              <div className="text-[10px] font-mono text-gray-600 mt-1">
                {a.bookingId}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
