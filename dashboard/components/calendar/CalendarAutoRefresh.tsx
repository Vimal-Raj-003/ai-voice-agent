"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps the Calendar in sync with bookings created OUTSIDE the browser (the
// voice agent writes Appointment rows directly to the DB). The page is already
// force-dynamic, so router.refresh() re-runs the server component and re-queries
// Postgres — no second data source, no websocket. We refresh on a gentle
// interval and whenever the tab regains focus, so a freshly booked appointment
// appears on its date without a manual reload.
export default function CalendarAutoRefresh({
  intervalMs = 20000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      // Skip refreshes while the tab is hidden to avoid needless queries.
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, intervalMs]);

  return null;
}
