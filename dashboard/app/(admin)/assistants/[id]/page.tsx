import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateAssistant, deleteAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";

export default async function AssistantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const a = await prisma.assistant.findUnique({ where: { id } });
  if (!a) notFound();
  const update = updateAssistant.bind(null, id);
  const remove = deleteAssistant.bind(null, id);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{a.name}</h1>
      <AssistantForm action={update} initial={a} />
      <form action={remove}>
        <button className="text-sm text-red-400 hover:text-red-300">
          Delete assistant
        </button>
      </form>
    </div>
  );
}
