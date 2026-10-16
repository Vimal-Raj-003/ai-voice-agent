"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { voiceService } from "@/lib/voice-service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/require-role";
import { computeReadiness } from "@/lib/campaign-readiness";

export async function createCampaign(formData: FormData) {
  await requireRole("ADMIN");
  const { id: orgId } = await getDefaultOrg();
  const scheduleTypeRaw = formData.get("scheduleType") as string | null;
  const c = await prisma.campaign.create({
    data: {
      organizationId: orgId,
      assistantId: (formData.get("assistantId") as string) || null,
      name: String(formData.get("name") || "New campaign"),
      prompt: String(formData.get("prompt") || "") || null,
      callDelaySeconds: Number(formData.get("callDelaySeconds") || 3),
      // Parallel dialing. Clamped to the option sets the form offers so a
      // hand-crafted POST cannot ask for an arbitrary concurrency; the
      // dispatcher still enforces the real provider ceiling on top.
      maxConcurrent: [3, 5, 10].includes(Number(formData.get("maxConcurrent")))
        ? Number(formData.get("maxConcurrent"))
        : 3,
      maxStartsPerMinute: [5, 10, 20].includes(Number(formData.get("maxStartsPerMinute")))
        ? Number(formData.get("maxStartsPerMinute"))
        : 10,
      scheduleType: scheduleTypeRaw ? (scheduleTypeRaw as any) : null,
      scheduleTime: String(formData.get("scheduleTime") || "") || null,
      agentProfileId: (formData.get("agentProfileId") as string) || null,
    },
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${c.id}`);
}

export async function updateCampaign(id: string, formData: FormData) {
  await requireRole("ADMIN");
  const scheduleTypeRaw = formData.get("scheduleType") as string | null;
  await prisma.campaign.update({
    where: { id },
    data: {
      assistantId: (formData.get("assistantId") as string) || null,
      name: String(formData.get("name") || ""),
      prompt: String(formData.get("prompt") || "") || null,
      callDelaySeconds: Number(formData.get("callDelaySeconds") || 3),
      // Parallel dialing. Clamped to the option sets the form offers so a
      // hand-crafted POST cannot ask for an arbitrary concurrency; the
      // dispatcher still enforces the real provider ceiling on top.
      maxConcurrent: [3, 5, 10].includes(Number(formData.get("maxConcurrent")))
        ? Number(formData.get("maxConcurrent"))
        : 3,
      maxStartsPerMinute: [5, 10, 20].includes(Number(formData.get("maxStartsPerMinute")))
        ? Number(formData.get("maxStartsPerMinute"))
        : 10,
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
  await requireRole("ADMIN");
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export type RunNowState = { error?: string } | undefined;

/**
 * Start a campaign immediately.
 *
 * PREFLIGHT IS ENFORCED HERE. The readiness checks used to be computed in the
 * page for display only, while this action posted straight to
 * /api/campaigns/{id}/run-now, which dispatches without any campaign-level
 * gate. Collapsing the readiness card into a popover would therefore have
 * hidden the checks AND left dispatch unguarded, so the same server-side
 * computation the indicator renders now also blocks the dispatch.
 *
 * The dispatcher is unchanged: it still re-checks DNC, quiet hours and
 * provider capacity per number at dial time.
 */
export async function runCampaignNow(_prev: RunNowState, formData: FormData): Promise<RunNowState> {
  await requireRole("AGENT");
  const id = String(formData.get("campaignId") || "");
  if (!id) return { error: "Missing campaign id." };

  const { id: orgId } = await getDefaultOrg();
  const readiness = await computeReadiness(id, orgId);
  if (!readiness) return { error: "Campaign not found for this organization." };
  if (!readiness.canStart) {
    return { error: `Cannot start: ${readiness.failures.join("; ")}` };
  }

  await voiceService.campaignRunNow(id);
  revalidatePath(`/campaigns/${id}`);
  return undefined;
}

export async function uploadTargets(id: string, formData: FormData) {
  await requireRole("ADMIN");
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
