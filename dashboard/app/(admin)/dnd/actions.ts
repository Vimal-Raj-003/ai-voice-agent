"use server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDefaultOrg } from "@/lib/org";
import { normalizePhone } from "@/lib/phone";
import { revalidatePath } from "next/cache";

export async function addDndNumber(formData: FormData): Promise<void> {
  const { user } = await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const phone = normalizePhone(String(formData.get("phone") || "")).e164;
  if (!phone) throw new Error("Invalid phone number");
  const reason = String(formData.get("reason") || "").trim() || null;
  await prisma.dndNumber.upsert({
    where: { organizationId_phoneE164: { organizationId: orgId, phoneE164: phone } },
    update: { reason, source: "MANUAL", addedBy: user.id },
    create: {
      organizationId: orgId,
      phoneE164: phone,
      reason,
      source: "MANUAL",
      addedBy: user.id,
    },
  });
  revalidatePath("/dnd");
}

export async function removeDndNumber(id: string): Promise<void> {
  await requireRole("ADMIN");
  await prisma.dndNumber.delete({ where: { id } });
  revalidatePath("/dnd");
}

export async function importDndCsv(formData: FormData): Promise<{ added: number; skipped: number }> {
  const { user } = await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file");
  const text = await file.text();
  let added = 0;
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const phone = normalizePhone(line.trim().split(",")[0]).e164;
    if (!phone) {
      skipped++;
      continue;
    }
    try {
      await prisma.dndNumber.create({
        data: {
          organizationId: orgId,
          phoneE164: phone,
          source: "CSV_IMPORT",
          addedBy: user.id,
        },
      });
      added++;
    } catch {
      skipped++;
    }
  }
  revalidatePath("/dnd");
  return { added, skipped };
}
