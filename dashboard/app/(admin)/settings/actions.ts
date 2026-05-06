"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function upsertSetting(formData: FormData) {
  const key = String(formData.get("key") || "").trim();
  const value = String(formData.get("value") || "");
  const sensitive = formData.get("sensitive") === "on";
  if (!key) return;
  await prisma.setting.upsert({
    where: { key },
    update: { value, isSensitive: sensitive },
    create: { key, value, isSensitive: sensitive },
  });
  revalidatePath("/settings");
}

export async function deleteSetting(key: string) {
  await prisma.setting.delete({ where: { key } });
  revalidatePath("/settings");
}
