"use server";
import { prisma } from "@/lib/prisma";
import { KNOWN_SETTINGS } from "@/lib/known-settings";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";

export async function upsertSetting(formData: FormData) {
  await requireRole("OWNER");
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
  await requireRole("OWNER");
  await prisma.setting.delete({ where: { key } });
  revalidatePath("/settings");
}

// Revert a stored override back to the env-supplied value. Same semantics as
// deleteSetting but expressed as a server action with a clearer name so the
// UI can wire it to a "Revert to env" button without leaking the underlying
// table mechanics. Silently no-ops when nothing is stored.
export async function revertSettingToEnv(key: string) {
  await requireRole("OWNER");
  if (!key) return;
  await prisma.setting.deleteMany({ where: { key } });
  revalidatePath("/settings");
}
