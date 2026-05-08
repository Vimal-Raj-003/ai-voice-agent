"use server";

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";

// Server actions for manual calendar management — admin can create a
// booking outside an agent flow (useful for filling no-shows / walk-ins),
// cancel a booking, or mark one as completed.

function shortBookingId(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export type CreateBookingResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string };

export async function createBooking(formData: FormData): Promise<CreateBookingResult> {
  await requireRole("AGENT");
  const name = String(formData.get("name") || "").trim();
  const rawPhone = String(formData.get("phone") || "").trim();
  const date = String(formData.get("date") || "").trim();
  const time = String(formData.get("time") || "").trim();
  const service = String(formData.get("service") || "").trim();

  if (!name) return { ok: false, error: "Name is required." };
  if (!rawPhone) return { ok: false, error: "Phone is required." };
  const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
  if (!/^\+\d{8,15}$/.test(phone))
    return { ok: false, error: "Phone must be E.164 (e.g. +919876543210)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { ok: false, error: "Date must be YYYY-MM-DD." };
  if (!/^\d{2}:\d{2}$/.test(time))
    return { ok: false, error: "Time must be HH:MM (24-hour)." };
  if (!service) return { ok: false, error: "Service is required." };

  const bookingId = shortBookingId();

  // Run in a transaction so the contact upsert and appointment insert
  // succeed or fail atomically. Same shape as voice-service's
  // db.insert_appointment which handles the agent-side path.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.contact.upsert({
        where: { phoneNumber: phone },
        update: {
          name: name || undefined,
        },
        create: {
          phoneNumber: phone,
          name,
        },
      });
      await tx.appointment.create({
        data: {
          bookingId,
          name,
          phoneNumber: phone,
          date,
          time,
          service,
          status: "BOOKED",
        },
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create booking.",
    };
  }

  revalidatePath("/calendar");
  return { ok: true, bookingId };
}

export async function cancelBooking(id: string): Promise<void> {
  await requireRole("AGENT");
  await prisma.appointment.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  revalidatePath("/calendar");
}

export async function markCompleted(id: string): Promise<void> {
  await requireRole("AGENT");
  await prisma.appointment.update({
    where: { id },
    data: { status: "COMPLETED" },
  });
  revalidatePath("/calendar");
}
