import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { updateCampaign, deleteCampaign } from "../actions";
import CampaignForm from "@/components/CampaignForm";
import CampaignTargets, { type TargetRow } from "@/components/CampaignTargets";
import CampaignHeaderActions from "@/components/CampaignHeaderActions";
import { computeReadiness } from "@/lib/campaign-readiness";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { id: orgId } = await getDefaultOrg();

  const [campaign, assistants, targets, total] = await Promise.all([
    // Tenant isolation: the campaign must belong to this organization.
    prisma.campaign.findFirst({ where: { id, organizationId: orgId } }),
    prisma.assistant.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
    }),
    prisma.campaignTarget.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, phoneNumber: true, leadName: true, status: true,
        attempts: true, callId: true, dispatchedAt: true, lastError: true,
      },
    }),
    prisma.campaignTarget.count({ where: { campaignId: id } }),
  ]);
  if (!campaign) notFound();

  // The SAME computation the Run now server action enforces — see
  // lib/campaign-readiness. Rendered compactly in the header rather than as a
  // full-width card, with no loss of validation.
  const readiness = await computeReadiness(id, orgId);

  const update = updateCampaign.bind(null, id);
  const remove = deleteCampaign.bind(null, id);

  const targetRows: TargetRow[] = targets.map((t) => ({
    ...t,
    dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BackLink fallback="/campaigns" label="Campaigns" formId="campaign-form" />
          <h1 className="min-w-0 truncate text-2xl font-bold">{campaign.name}</h1>
        </div>
        {readiness && (
          <CampaignHeaderActions
            campaignId={id}
            name={campaign.name}
            checks={readiness.checks}
            counts={readiness.counts}
            canStart={readiness.canStart}
            pending={readiness.pending}
          />
        )}
      </div>

      {/* Settings left, targets right. The readiness card that used to occupy
          the right column is gone; its checks live in the header indicator,
          and nothing is left behind in its place. */}
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <CampaignForm action={update} assistants={assistants} initial={campaign} />
        </div>
        <div className="min-w-0">
          <CampaignTargets campaignId={id} targets={targetRows} total={total} />
        </div>
      </div>

      <form action={remove} className="border-t border-white/10 pt-3">
        <button className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300">
          Delete campaign
        </button>
      </form>
    </div>
  );
}
