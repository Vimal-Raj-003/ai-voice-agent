import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { updateAssistant, deleteAssistant } from "../actions";
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
  const update = updateAssistant.bind(null, id);
  const remove = deleteAssistant.bind(null, id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{a.name}</h1>
      <AssistantForm
        action={update}
        initial={a}
        tools={tools}
        selectedToolIds={bindings.map((b) => b.toolId)}
      />
      <form action={remove}>
        <button className="text-sm text-red-400 hover:text-red-300">
          Delete assistant
        </button>
      </form>
    </div>
  );
}
