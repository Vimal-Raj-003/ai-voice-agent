"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { voiceService } from "@/lib/voice-service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createCampaign(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const scheduleTypeRaw = formData.get("scheduleType") as string | null;
  const c = await prisma.campaign.create({
    data: {
      organizationId: orgId,
      assistantId: (formData.get("assistantId") as string) || null,
      name: String(formData.get("name") || "New campaign"),
      prompt: String(formData.get("prompt") || "") || null,
      callDelaySeconds: Number(formData.get("callDelaySeconds") || 3),
      scheduleType: scheduleTypeRaw ? (scheduleTypeRaw as any) : null,
      scheduleTime: String(formData.get("scheduleTime") || "") || null,
      agentProfileId: (formData.get("agentProfileId") as string) || null,
    },
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${c.id}`);
}

export async function updateCampaign(id: string, formData: FormData) {
  const scheduleTypeRaw = formData.get("scheduleType") as string | null;
  await prisma.campaign.update({
    where: { id },
    data: {
      assistantId: (formData.get("assistantId") as string) || null,
      name: String(formData.get("name") || ""),
      prompt: String(formData.get("prompt") || "") || null,
      callDelaySeconds: Number(formData.get("callDelaySeconds") || 3),
      scheduleType: scheduleTypeRaw ? (scheduleTypeRaw as any) : null,
      scheduleTime: String(formData.get("scheduleTime") || "") || null,
      status: (formData.get("status") as string || "DRAFT") as any,
      agentProfileId: (formData.get("agentProfileId") as string) || null,
    },
  });
  try {
    await voiceService.campaignSchedulerReload();
  } catch {
    // voice-service may be offline; continue
  }
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

export async function deleteCampaign(id: string) {
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function runCampaignNow(id: string) {
  await voiceService.campaignRunNow(id);
  revalidatePath(`/campaigns/${id}`);
}

export async function uploadTargets(id: string, formData: FormData) {
  const csv = String(formData.get("csv") || "").trim();
  if (!csv) return;
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("phone");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      return { phone: cols[0] || "", lead_name: cols[1] || null };
    })
    .filter((r) => r.phone.startsWith("+"));
  if (rows.length === 0) return;
  await prisma.campaignTarget.createMany({
    data: rows.map((r) => ({
      campaignId: id,
      phoneNumber: r.phone,
      leadName: r.lead_name ?? undefined,
    })),
    skipDuplicates: true,
  });
  await prisma.campaign.update({
    where: { id },
    data: { totalTargets: { increment: rows.length } },
  });
  revalidatePath(`/campaigns/${id}`);
}
