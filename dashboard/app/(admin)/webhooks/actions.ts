"use server";

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import type { WebhookEvent } from "@prisma/client";
import { requireRole } from "@/lib/require-role";

const ALL_EVENTS: WebhookEvent[] = [
  "CALL_STARTED",
  "CALL_ENDED",
  "CALL_FAILED",
  "TRANSCRIPT_UPDATE",
  "TRANSFER_INITIATED",
];

function parseEvents(formData: FormData): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  for (const e of ALL_EVENTS) {
    if (formData.get(`event_${e}`) === "on") events.push(e);
  }
  return events;
}

export async function createWebhook(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const url = String(formData.get("url") || "").trim();
  if (!url.startsWith("http")) return;
  const events = parseEvents(formData);
  const isActive = formData.get("isActive") === "on";
  const secret =
    String(formData.get("secret") || "").trim() ||
    crypto.randomBytes(24).toString("hex");
  const w = await prisma.webhook.create({
    data: { organizationId: orgId, url, secret, isActive, events },
  });
  revalidatePath("/webhooks");
  redirect(`/webhooks/${w.id}`);
}

export async function updateWebhook(id: string, formData: FormData) {
  const url = String(formData.get("url") || "").trim();
  const events = parseEvents(formData);
  const isActive = formData.get("isActive") === "on";
  const secretRaw = String(formData.get("secret") || "").trim();
  await prisma.webhook.update({
    where: { id },
    data: {
      url,
      isActive,
      events,
      ...(secretRaw ? { secret: secretRaw } : {}),
    },
  });
  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${id}`);
}

export async function deleteWebhook(id: string) {
  await prisma.webhook.delete({ where: { id } });
  revalidatePath("/webhooks");
  redirect("/webhooks");
}

export async function retryDelivery(deliveryId: string): Promise<void> {
  await requireRole("ADMIN");
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date() },
  });
  revalidatePath("/webhooks");
}

export async function replayAllDeadLetters(webhookId: string): Promise<void> {
  await requireRole("ADMIN");
  await prisma.webhookDelivery.updateMany({
    where: { webhookId, status: "DEAD_LETTER" },
    data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date(), attemptsMade: 0 },
  });
  revalidatePath("/webhooks");
}
