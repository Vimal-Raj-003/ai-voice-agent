import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import {
  updateCampaign,
  deleteCampaign,
  runCampaignNow,
  uploadTargets,
} from "../actions";
import CampaignForm from "@/components/CampaignForm";
import TargetsUploader from "@/components/TargetsUploader";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { id: orgId } = await getDefaultOrg();
  const [campaign, assistants, targets] = await Promise.all([
    prisma.campaign.findUnique({ where: { id } }),
    prisma.assistant.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
    }),
    prisma.campaignTarget.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  if (!campaign) notFound();

  const update = updateCampaign.bind(null, id);
  const remove = deleteCampaign.bind(null, id);
  const runNow = runCampaignNow.bind(null, id);
  const upload = uploadTargets.bind(null, id);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{campaign.name}</h1>
        <form action={runNow}>
          <button className="rounded-lg bg-purple-600 text-white px-4 py-2 text-sm font-medium hover:bg-purple-500">
            Run now
          </button>
        </form>
      </div>

      <CampaignForm action={update} assistants={assistants} initial={campaign} />

      <form action={remove}>
        <button className="text-sm text-red-400 hover:text-red-300">
          Delete campaign
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upload targets (CSV)</h2>
        <p className="text-xs text-gray-500">
          Format: <code>phone,lead_name</code> (header row optional; phone must
          start with +)
        </p>
        <TargetsUploader action={upload} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Targets ({campaign.totalTargets} total)
        </h2>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
          {targets.length === 0 && (
            <div className="p-4 text-gray-500 text-sm">No targets yet.</div>
          )}
          {targets.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between p-3 text-sm"
            >
              <div>
                <div className="font-mono">{t.phoneNumber}</div>
                {t.leadName && (
                  <div className="text-xs text-gray-500">{t.leadName}</div>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{t.attempts} attempts</span>
                <span
                  className={
                    t.status === "COMPLETED"
                      ? "text-green-400"
                      : t.status === "FAILED"
                      ? "text-red-400"
                      : t.status === "DISPATCHED"
                      ? "text-blue-400"
                      : "text-gray-400"
                  }
                >
                  {t.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
