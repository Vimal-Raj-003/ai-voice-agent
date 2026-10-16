// Reminder timing for dashboard-created bookings.
//
// This is a deliberate mirror of voice-service/tools.py `reminder_at_utc` so a
// manually created booking and an agent-created one schedule reminders the same
// way, read the same env vars, and are consumed by the same poller
// (_poll_reminders, 60s, PENDING -> SENT, restart-safe).
//
// Keep in sync with:
//   config.APPOINTMENT_REMINDER_ENABLED
//   config.APPOINTMENT_REMINDER_MINUTES_BEFORE

export function remindersEnabled(): boolean {
  return (process.env.APPOINTMENT_REMINDER_ENABLED ?? "true").toLowerCase() !== "false";
}

export function reminderMinutesBefore(): number {
  const n = Number(process.env.APPOINTMENT_REMINDER_MINUTES_BEFORE ?? 60);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 60;
}

/**
 * Offset of an IANA zone from UTC at a given instant, in minutes.
 *
 * Derived from Intl rather than a fixed +05:30 so the same code is correct for
 * a booking stored in another timezone, and across a DST boundary.
 */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour === "24" ? "00" : p.hour), Number(p.minute), Number(p.second),
  );
  return (asUtc - at.getTime()) / 60000;
}

/**
 * The UTC instant to remind the customer: appointment time minus the configured
 * lead time. Returns null when reminders are disabled, the input is unparseable,
 * or the appointment is too soon for a pre-reminder (same rule as the agent).
 */
export function reminderAtUtc(
  date: string,
  time: string,
  timeZone = process.env.CALCOM_TIMEZONE || "Asia/Kolkata",
): Date | null {
  if (!remindersEnabled()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (h > 23 || mi > 59) return null;

  // Interpret the wall-clock time in `timeZone`: start from the naive UTC
  // reading, then correct by that zone's offset at roughly that instant.
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = zoneOffsetMinutes(new Date(naive), timeZone);
  const apptUtcMs = naive - offset * 60000;

  const remindMs = apptUtcMs - reminderMinutesBefore() * 60000;
  return remindMs > Date.now() ? new Date(remindMs) : null;
}
