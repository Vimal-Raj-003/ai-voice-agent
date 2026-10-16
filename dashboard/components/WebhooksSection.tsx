import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus, Webhook as WebhookIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/Badge";
import type { WebhookEvent } from "@prisma/client";

// The former /webhooks page body, moved verbatim so it renders as a tab of
// Settings — the same approach already used for API Keys.
//
// It stays a SERVER component: the list is read with prisma, scoped to the
// organization exactly as before, and the create/edit screens remain their own
// routes (/webhooks/new, /webhooks/{id}) so their server actions, validation
// and redirects are untouched. Nothing about webhook event generation,
// delivery, retries, secrets or signature verification is involved here — this
// file only lists what already exists.
//
// The page-level <h1>Webhooks</h1> is intentionally dropped: Settings already
// renders its own heading, and keeping it produced two titles on one screen.
export default async function WebhooksSection() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.webhook.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { deliveries: true } } },
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {rows.length === 0
            ? "No endpoints configured."
            : `${rows.length} endpoint${rows.length === 1 ? "" : "s"} configured.`}
        </p>
        <Link
          href="/webhooks/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black hover:opacity-90"
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
                    <span className="truncate font-mono text-sm">{w.url}</span>
                    <Badge tone={w.isActive ? "success" : "muted"}>
                      {w.isActive ? "active" : "paused"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {events.length} event{events.length === 1 ? "" : "s"} ·{" "}
                    {w._count.deliveries} deliveries
                  </div>
                </div>
                <span className="shrink-0 text-xs text-gray-500">
                  {w.createdAt.toLocaleDateString()}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
