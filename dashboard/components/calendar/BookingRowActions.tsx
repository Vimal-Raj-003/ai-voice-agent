"use client";

import { useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { cancelBooking } from "@/app/(admin)/calendar/actions";

// Per-row cancel button. Shown only when status === BOOKED. Inline next to
// the existing status badge.
export default function BookingRowActions({
  appointmentId,
  status,
}: {
  appointmentId: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  if (status !== "BOOKED") return null;
  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await cancelBooking(appointmentId);
        })
      }
      disabled={pending}
      className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/[0.05] px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/[0.12] disabled:opacity-50"
      aria-label="Cancel booking"
    >
      {pending ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
      Cancel
    </button>
  );
}
