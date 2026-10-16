"use server";

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";
import { calcomCancel, calcomStatus } from "@/lib/calcom";
import { reminderAtUtc, remindersEnabled } from "@/lib/reminders";
import type { Prisma } from "@prisma/client";

// Server actions for manual calendar management — admin can create a
// booking outside an agent flow (useful for filling no-shows / walk-ins),
// reschedule it, cancel it, or mark one as completed.
//
// SYNCHRONISATION POLICY (single source of truth = Neon):
//   * Neon `appointments` is authoritative for status and scheduling.
//   * An external provider row is linked by calcomBookingUid / gcalEventId.
//     When a linked booking is cancelled, the EXTERNAL cancel runs FIRST and
//     the local row is only updated if it succeeds, so the two never drift.
//   * A manual booking created here is LOCAL ONLY. It does not create a
//     Cal.com or Google Calendar event, and the UI says so rather than
//     implying a sync that did not happen.

function shortBookingId(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export type BookingResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string };

// Back-compat alias: BookingForm imported this name before reschedule existed.
export type CreateBookingResult = BookingResult;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** Minutes since midnight, or null when unparseable. */
function toMinutes(t: string): number | null {
  if (!TIME_RE.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

type Parsed = {
  name: string; phone: string; email: string | null; date: string; time: string;
  service: string; durationMinutes: number; timezone: string; host: string | null;
  notes: string | null; status: "BOOKED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
};

function parseBooking(formData: FormData): Parsed | string {
  const name = String(formData.get("name") || "").trim();
  const rawPhone = String(formData.get("phone") || "").trim();
  const date = String(formData.get("date") || "").trim();
  const time = String(formData.get("time") || "").trim();
  const service = String(formData.get("service") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const host = String(formData.get("host") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const timezone = String(formData.get("timezone") || "").trim() || "Asia/Kolkata";
  const durationRaw = Number(formData.get("durationMinutes") || 30);
  const statusRaw = String(formData.get("status") || "BOOKED").trim();

  if (!name) return "Name is required.";
  if (!rawPhone) return "Phone is required.";
  const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
  if (!/^\+\d{8,15}$/.test(phone)) return "Phone must be E.164 (e.g. +919876543210).";
  if (!DATE_RE.test(date)) return "Date must be YYYY-MM-DD.";
  if (toMinutes(time) === null) return "Time must be HH:MM (24-hour).";
  if (!service) return "Service is required.";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "Email address is not valid.";
  if (!Number.isFinite(durationRaw) || durationRaw < 5 || durationRaw > 480)
    return "Duration must be between 5 and 480 minutes.";
  const status = (["BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const)
    .find((s) => s === statusRaw);
  if (!status) return "Unknown booking status.";

  return {
    name, phone, email, date, time, service,
    durationMinutes: Math.round(durationRaw), timezone, host, notes, status,
  };
}

/**
 * Overlap check for the same resource.
 *
 * The DB partial unique indexes stop an EXACT duplicate slot; this catches a
 * partial overlap (10:00-10:30 vs 10:15-10:45), which an index cannot express.
 * Scoped to the same day and to active bookings only.
 */
async function findConflict(
  p: Parsed, excludeId?: string,
): Promise<string | null> {
  const start = toMinutes(p.time)!;
  const end = start + p.durationMinutes;
  const sameDay = await prisma.appointment.findMany({
    where: {
      date: p.date,
      status: "BOOKED",
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ phoneNumber: p.phone }, ...(p.host ? [{ host: p.host }] : [])],
    },
    select: { time: true, durationMinutes: true, phoneNumber: true, host: true, name: true },
  });
  for (const a of sameDay) {
    const aStart = toMinutes(a.time);
    if (aStart === null) continue;
    const aEnd = aStart + (a.durationMinutes || 30);
    if (start < aEnd && aStart < end) {
      const who = a.host && p.host && a.host === p.host ? `${a.host} is` : `${a.name} is`;
      return `${who} already booked at ${a.time} for ${a.durationMinutes || 30} min on ${p.date}.`;
    }
  }
  return null;
}

/**
 * Schedule the customer reminder for a booking, replacing any pending one.
 *
 * Reuses the existing appointment_reminders table and the voice-service poller
 * (60s, PENDING -> SENT, restart-safe). Superseding the previous PENDING row is
 * what stops a reschedule from firing two reminders.
 */
async function syncReminder(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  phone: string,
  date: string,
  time: string,
  timezone: string,
) {
  await tx.appointmentReminder.updateMany({
    where: { appointmentId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (!remindersEnabled()) return;
  const at = reminderAtUtc(date, time, timezone);
  if (!at) return; // disabled, or the appointment is too soon to pre-remind
  await tx.appointmentReminder.create({
    data: { appointmentId, customerPhone: phone, reminderAt: at, status: "PENDING" },
  });
}

export async function createBooking(formData: FormData): Promise<BookingResult> {
  await requireRole("AGENT");
  const parsed = parseBooking(formData);
  if (typeof parsed === "string") return { ok: false, error: parsed };

  const conflict = await findConflict(parsed);
  if (conflict) return { ok: false, error: conflict };

  const bookingId = shortBookingId();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.upsert({
        where: { phoneNumber: parsed.phone },
        update: { name: parsed.name || undefined, email: parsed.email ?? undefined },
        create: { phoneNumber: parsed.phone, name: parsed.name, email: parsed.email },
      });
      const appt = await tx.appointment.create({
        data: {
          bookingId,
          name: parsed.name,
          phoneNumber: parsed.phone,
          email: parsed.email,
          date: parsed.date,
          time: parsed.time,
          service: parsed.service,
          durationMinutes: parsed.durationMinutes,
          timezone: parsed.timezone,
          host: parsed.host,
          notes: parsed.notes,
          status: parsed.status,
        },
        select: { id: true },
      });
      if (parsed.status === "BOOKED") {
        await syncReminder(tx, appt.id, parsed.phone, parsed.date, parsed.time, parsed.timezone);
      }
    });
  } catch (err) {
    // The partial unique indexes turn a duplicate active slot into P2002.
    const msg = err instanceof Error ? err.message : "Failed to create booking.";
    if (msg.includes("appointments_active_customer_slot_idx") || msg.includes("Unique constraint")) {
      return { ok: false, error: "That customer already has a booking in this slot." };
    }
    if (msg.includes("appointments_active_host_slot_idx")) {
      return { ok: false, error: "That host is already booked in this slot." };
    }
    return { ok: false, error: msg };
  }

  revalidatePath("/calendar");
  return { ok: true, bookingId };
}

/**
 * Move an existing booking. Local-only, like createBooking: a linked Cal.com
 * or Google event is NOT moved, so rescheduling is refused for linked bookings
 * rather than silently drifting from the provider.
 */
export async function rescheduleBooking(
  id: string, formData: FormData,
): Promise<BookingResult> {
  await requireRole("AGENT");
  const existing = await prisma.appointment.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Booking not found." };
  if (existing.status !== "BOOKED") {
    return { ok: false, error: `Cannot reschedule a ${existing.status} booking.` };
  }
  if (existing.calcomBookingUid || existing.gcalEventId) {
    return {
      ok: false,
      error: "This booking is linked to an external calendar. Reschedule it there, " +
             "or cancel and rebook — moving it here would drift from the provider.",
    };
  }

  const date = String(formData.get("date") || "").trim();
  const time = String(formData.get("time") || "").trim();
  if (!DATE_RE.test(date)) return { ok: false, error: "Date must be YYYY-MM-DD." };
  if (toMinutes(time) === null) return { ok: false, error: "Time must be HH:MM (24-hour)." };

  const durationRaw = Number(formData.get("durationMinutes") || existing.durationMinutes);
  const probe: Parsed = {
    name: existing.name, phone: existing.phoneNumber, email: existing.email,
    date, time, service: existing.service,
    durationMinutes: Number.isFinite(durationRaw) ? Math.round(durationRaw) : existing.durationMinutes,
    timezone: existing.timezone, host: existing.host, notes: existing.notes, status: "BOOKED",
  };
  if (date === existing.date && time === existing.time &&
      probe.durationMinutes === existing.durationMinutes) {
    return { ok: false, error: "That is already this booking's slot." };
  }
  const conflict = await findConflict(probe, id);
  if (conflict) return { ok: false, error: conflict };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data: { date, time, durationMinutes: probe.durationMinutes },
      });
      // Supersede the old PENDING reminder so a reschedule cannot fire two.
      await syncReminder(tx, id, existing.phoneNumber, date, time, existing.timezone);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to reschedule.";
    if (msg.includes("Unique constraint") || msg.includes("_slot_idx")) {
      return { ok: false, error: "That slot is already taken." };
    }
    return { ok: false, error: msg };
  }
  revalidatePath("/calendar");
  return { ok: true, bookingId: existing.bookingId };
}

export async function cancelBooking(id: string): Promise<void> {
  await requireRole("AGENT");
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) return;
  // If this appointment is linked to Cal.com and Cal.com is configured, cancel
  // it externally FIRST. Only mark the local row cancelled when that succeeds,
  // so the two systems never drift out of sync.
  // Ask the service that owns the credential; never assume it is configured.
  const cal = await calcomStatus();
  if (appt.calcomBookingUid && cal.configured) {
    const res = await calcomCancel(appt.calcomBookingUid, "Cancelled from dashboard");
    if (!res.ok) {
      throw new Error(
        `Could not cancel the Cal.com booking (${res.error}); local booking left unchanged.`,
      );
    }
  }
  // Cancel the appointment and any pending reminder together, so a cancelled
  // appointment never fires a customer reminder.
  await prisma.$transaction([
    prisma.appointment.update({ where: { id }, data: { status: "CANCELLED" } }),
    prisma.appointmentReminder.updateMany({
      where: { appointmentId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    }),
  ]);
  revalidatePath("/calendar");
}

export async function markCompleted(id: string): Promise<void> {
  await requireRole("AGENT");
  // A completed appointment must not still fire a "see you soon" reminder.
  await prisma.$transaction([
    prisma.appointment.update({ where: { id }, data: { status: "COMPLETED" } }),
    prisma.appointmentReminder.updateMany({
      where: { appointmentId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    }),
  ]);
  revalidatePath("/calendar");
}
