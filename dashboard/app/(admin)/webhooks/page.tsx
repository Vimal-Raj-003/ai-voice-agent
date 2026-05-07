import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus, Webhook as WebhookIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/Badge";
import type { WebhookEvent } from "@prisma/client";

export default async function WebhooksPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.webhook.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { deliveries: true } } },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Webhooks</h1>
        <Link
          href="/webhooks/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} /> New
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title="No webhooks yet"
          description="Webhooks fire on call lifecycle events (started, ended, failed, transcript updates) so you can pipe activity into n8n, your CRM, or a Slack channel."
          action={{
            href: "/webhooks/new",
            label: "Create your first webhook",
          }}
        />
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/5">
          {rows.map((w) => {
            const events = (w.events as WebhookEvent[]) ?? [];
            return (
              <Link
                key={w.id}
                href={`/webhooks/${w.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm truncate">{w.url}</span>
                    <Badge tone={w.isActive ? "success" : "muted"}>
                      {w.isActive ? "active" : "paused"}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {events.length} event{events.length === 1 ? "" : "s"} ·{" "}
                    {w._count.deliveries} deliveries
                  </div>
                </div>
                <span className="text-xs text-gray-500 shrink-0">
                  {w.createdAt.toLocaleDateString()}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
