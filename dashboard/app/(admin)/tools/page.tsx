import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus, Wrench } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/Badge";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.tool.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { invocations: true, assistants: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tools</h1>
          <p className="text-sm text-gray-400 mt-1">
            Custom HTTP tools your assistants can call mid-conversation. Bind a
            tool to an assistant on the assistant&apos;s edit page.
          </p>
        </div>
        <Link
          href="/tools/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} /> New tool
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No tools yet"
          description="Define an HTTP endpoint as a function the LLM can invoke. Useful for live lookups (weather, inventory, CRM), confirmations, anything you don't want to bake into the prompt."
          action={{ href: "/tools/new", label: "Create your first tool" }}
        />
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/5">
          {rows.map((t) => (
            <Link
              key={t.id}
              href={`/tools/${t.id}`}
              className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{t.name}</span>
                  <Badge tone={t.isActive ? "success" : "muted"}>
                    {t.isActive ? "active" : "paused"}
                  </Badge>
                  <span className="text-[10px] uppercase text-gray-500 tracking-widest">
                    {t.kind} · {t.httpMethod ?? "—"}
                  </span>
                </div>
                {t.description && (
                  <div className="text-xs text-gray-500 mt-1 line-clamp-1">
                    {t.description}
                  </div>
                )}
                <div className="text-[10px] text-gray-600 mt-0.5">
                  {t._count.assistants} assistant
                  {t._count.assistants === 1 ? "" : "s"} ·{" "}
                  {t._count.invocations} invocation
                  {t._count.invocations === 1 ? "" : "s"}
                </div>
              </div>
              <span className="text-xs text-gray-500 shrink-0">
                {t.createdAt.toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
