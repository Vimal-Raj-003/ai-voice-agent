"use server";

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const E164 = /^\+\d{8,15}$/;

function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v || "").trim();
  return s ? s : null;
}

export async function createPhoneNumber(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const number = String(formData.get("number") || "").trim();
  if (!E164.test(number)) {
    throw new Error("Number must be E.164 (e.g. +918065480036)");
  }
  const p = await prisma.phoneNumber.create({
    data: {
      organizationId: orgId,
      number,
      assistantId: nullable(formData.get("assistantId")),
      label: nullable(formData.get("label")),
      provider: String(formData.get("provider") || "vobiz"),
      isActive: formData.get("isActive") !== "false",
    },
  });
  revalidatePath("/phone-numbers");
  redirect(`/phone-numbers/${p.id}`);
}

export async function updatePhoneNumber(id: string, formData: FormData) {
  await prisma.phoneNumber.update({
    where: { id },
    data: {
      assistantId: nullable(formData.get("assistantId")),
      label: nullable(formData.get("label")),
      provider: String(formData.get("provider") || "vobiz"),
      isActive: formData.get("isActive") !== "false",
    },
  });
  revalidatePath("/phone-numbers");
  revalidatePath(`/phone-numbers/${id}`);
}

export async function deletePhoneNumber(id: string) {
  await prisma.phoneNumber.delete({ where: { id } });
  revalidatePath("/phone-numbers");
  redirect("/phone-numbers");
}
