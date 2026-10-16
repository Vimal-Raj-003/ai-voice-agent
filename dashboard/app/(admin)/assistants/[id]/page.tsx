import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { deleteAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";

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
    <div>
      {/* The heading and both page actions live in AssistantForm's header so
          Save can carry the form's pending state. `remove` is the same bound
          deleteAssistant action as before — AssistantForm renders it as its
          own <form>, a SIBLING of the assistant form (nesting would be invalid
          HTML and would break submission). Authorization and the redirect are
          unchanged. */}
      <AssistantForm
        mode="edit"
        initial={a}
        tools={tools}
        selectedToolIds={bindings.map((b) => b.toolId)}
        transferTargets={transferTargets}
        title={a.name}
        dangerAction={remove}
      />
    </div>
  );
}
