"use server";

import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { generateApiKey } from "@/lib/api-key";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/require-role";

export type CreateResult =
  | { ok: true; plaintext: string; prefix: string }
  | { ok: false; error: string };

export async function createApiKey(formData: FormData): Promise<CreateResult> {
  await requireRole("OWNER");
  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  const { id: orgId } = await getDefaultOrg();
  const { key, prefix, hash } = generateApiKey();
  await prisma.apiKey.create({
    data: { organizationId: orgId, name, keyHash: hash, prefix },
  });
  revalidatePath("/api-keys");
  return { ok: true, plaintext: key, prefix };
}

export async function revokeApiKey(id: string) {
  await requireRole("OWNER");
  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/api-keys");
}

export async function deleteApiKey(id: string) {
  await requireRole("OWNER");
  await prisma.apiKey.delete({ where: { id } });
  revalidatePath("/api-keys");
}
