import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus } from "lucide-react";
import { Badge, campaignStatusTone } from "@/components/Badge";

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
        {rows.map((c) => {
          const dispatched = c.dispatchedTargets ?? 0;
          const total = c.totalTargets ?? c._count.targets;
          const pct = total > 0 ? Math.round((dispatched / total) * 100) : 0;
          return (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}`}
              className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Badge tone={campaignStatusTone(c.status)}>{c.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>
                    {c._count.targets} target{c._count.targets === 1 ? "" : "s"}
                  </span>
                  {c.scheduleType && (
                    <span>
                      · {c.scheduleType.toLowerCase()}
                      {c.scheduleTime ? ` @ ${c.scheduleTime}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium">
                  {dispatched}/{total}
                </div>
                <div className="text-xs text-gray-500">{pct}% dispatched</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
