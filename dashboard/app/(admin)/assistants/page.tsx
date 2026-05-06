import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus } from "lucide-react";

export default async function AssistantsPage() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.assistant.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Assistants</h1>
        <Link
          href="/assistants/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} /> New
        </Link>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && (
          <div className="p-6 text-gray-500">No assistants yet.</div>
        )}
        {rows.map((a) => (
          <Link
            key={a.id}
            href={`/assistants/${a.id}`}
            className="flex items-center justify-between p-4 hover:bg-white/[0.02]"
          >
            <div>
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-gray-500">
                {a.llmProvider}/{a.llmModel} · TTS {a.ttsProvider}
                {a.voiceId ? `/${a.voiceId}` : ""}
              </div>
            </div>
            <span className="text-xs text-gray-500">
              {a.updatedAt.toLocaleString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
