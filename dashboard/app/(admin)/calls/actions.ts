"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveCallNotes(callId: string, formData: FormData) {
  const notes = String(formData.get("notes") ?? "").slice(0, 4000);
  await prisma.call.update({
    where: { id: callId },
    data: { notes },
  });
  revalidatePath(`/calls/${callId}`);
}
