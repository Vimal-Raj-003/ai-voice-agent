import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus } from "lucide-react";

export default async function CampaignsPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.campaign.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { targets: true } } },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Campaigns</h1>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> New
        </Link>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && (
          <div className="p-6 text-gray-500">No campaigns yet.</div>
        )}
        {rows.map((c) => (
          <Link
            key={c.id}
            href={`/campaigns/${c.id}`}
            className="flex items-center justify-between p-4 hover:bg-white/[0.02]"
          >
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-gray-500">
                {c.status} · {c._count.targets} targets ·{" "}
                {c.scheduleType ?? "—"} {c.scheduleTime ?? ""}
              </div>
            </div>
            <span className="text-xs text-gray-500">
              {c.dispatchedTargets}/{c.totalTargets} dispatched
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
