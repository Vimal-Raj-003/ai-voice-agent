"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updateContact(phone: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const tagsRaw = String(formData.get("tags") ?? "").trim();

  // Stored as JSON string per schema; tolerate both an already-JSON-shaped
  // value (for round-tripped saves) and plain comma-separated user input.
  let tags: string;
  try {
    const parsed = JSON.parse(tagsRaw);
    tags = Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
  } catch {
    const arr = tagsRaw
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    tags = JSON.stringify(arr);
  }

  await prisma.contact.update({
    where: { phoneNumber: phone },
    data: { name, email, notes, tags },
  });
  revalidatePath(`/contacts/${encodeURIComponent(phone)}`);
  revalidatePath("/contacts");
}
