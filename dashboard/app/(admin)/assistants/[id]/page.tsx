import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { deleteAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";
import UrlSetup from "@/components/UrlSetup";

export const dynamic = "force-dynamic";

export default async function AssistantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { id: orgId } = await getDefaultOrg();
  const [a, tools, bindings] = await Promise.all([
    prisma.assistant.findUnique({ where: { id } }),
    prisma.tool.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, isActive: true },
    }),
    prisma.assistantTool.findMany({
      where: { assistantId: id },
      select: { toolId: true },
    }),
  ]);
  if (!a) notFound();
  // Human call forwarding destinations for this assistant.
  const transferTargets = await prisma.humanTransferTarget.findMany({
    where: { assistantId: id },
    orderBy: { priority: "asc" },
    select: { category: true, label: true, phoneE164: true, enabled: true, priority: true },
  });
  const remove = deleteAssistant.bind(null, id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{a.name}</h1>
      <AssistantForm
        mode="edit"
        initial={a}
        tools={tools}
        selectedToolIds={bindings.map((b) => b.toolId)}
        transferTargets={transferTargets}
      />
      {/* Website knowledge for THIS assistant only. */}
      <UrlSetup assistantId={id} />
      <form action={remove}>
        <button className="text-sm text-red-400 hover:text-red-300">
          Delete assistant
        </button>
      </form>
    </div>
  );
}
