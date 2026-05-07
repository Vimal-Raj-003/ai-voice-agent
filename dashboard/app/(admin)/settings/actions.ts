"use server";
import { prisma } from "@/lib/prisma";
import { KNOWN_SETTINGS } from "@/lib/known-settings";
import { revalidatePath } from "next/cache";

export async function upsertSetting(formData: FormData) {
  const key = String(formData.get("key") || "").trim();
  const value = String(formData.get("value") || "");
  if (!key) return;
  // Look up sensitivity from the central registry; fall back to the form
  // hint for ad-hoc keys that aren't in KNOWN_SETTINGS.
  const known = KNOWN_SETTINGS.find((s) => s.key === key);
  const sensitive = known?.sensitive ?? formData.get("sensitive") === "on";
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
