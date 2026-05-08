import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus, Hash } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/Badge";

export const dynamic = "force-dynamic";

export default async function PhoneNumbersPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.phoneNumber.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    include: { assistant: { select: { id: true, name: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Phone numbers</h1>
          <p className="text-sm text-gray-400 mt-1">
            Bind your inbound numbers to specific assistants. Unassigned
            numbers fall through to the default agent profile.
          </p>
        </div>
        <Link
          href="/phone-numbers/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} /> New
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="No numbers yet"
          description="Bind your Vobiz inbound numbers to specific assistants here. The agent will look up the dialed-to number and load that assistant's config for the call."
          action={{ href: "/phone-numbers/new", label: "Add a number" }}
        />
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/5">
          {rows.map((p) => (
            <Link
              key={p.id}
              href={`/phone-numbers/${p.id}`}
              className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{p.number}</span>
                  <Badge tone={p.isActive ? "success" : "muted"}>
                    {p.isActive ? "active" : "paused"}
                  </Badge>
                  <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                    {p.provider}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {p.assistant ? (
                    <>
                      → <span className="text-gray-300">{p.assistant.name}</span>
                    </>
                  ) : (
                    <span className="text-gray-600">unassigned</span>
                  )}
                  {p.label && <span className="ml-2 text-gray-600">· {p.label}</span>}
                </div>
              </div>
              <span className="text-xs text-gray-500 shrink-0">
                {p.createdAt.toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
