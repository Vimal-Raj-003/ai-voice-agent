"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";

export async function saveCallNotes(callId: string, formData: FormData) {
  await requireRole("AGENT");
  const notes = String(formData.get("notes") ?? "").slice(0, 4000);
  await prisma.call.update({
    where: { id: callId },
    data: { notes },
  });
  revalidatePath(`/calls/${callId}`);
}
