import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateTool, deleteTool } from "../actions";
import ToolForm from "@/components/ToolForm";
import { Badge } from "@/components/Badge";

export const dynamic = "force-dynamic";

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await prisma.tool.findUnique({ where: { id } });
  if (!t) notFound();
  const recent = await prisma.toolInvocation.findMany({
    where: { toolId: id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold font-mono">{t.name}</h1>
          <Badge tone={t.isActive ? "success" : "muted"}>
            {t.isActive ? "active" : "paused"}
          </Badge>
        </div>
        <p className="text-xs text-gray-500">
          Created {t.createdAt.toLocaleString()} · Updated{" "}
          {t.updatedAt.toLocaleString()}
        </p>
      </div>

      <ToolForm action={updateTool.bind(null, id)} initial={t} isEdit />

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
          Recent invocations
          <span className="ml-2 text-xs text-gray-500 font-normal normal-case">
            {recent.length}
          </span>
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500">
            No invocations yet — bind this tool to an assistant and place a
            test call that triggers it.
          </p>
        ) : (
          <ul className="space-y-2 text-xs">
            {recent.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-violet-200">
                    call {r.callId.slice(0, 8)}…
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {r.durationMs ?? "—"} ms ·{" "}
                    {r.createdAt.toLocaleTimeString()}
                  </span>
                </div>
                {r.error && (
                  <div className="mt-1 text-red-300 text-[11px]">
                    {r.error}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={deleteTool.bind(null, id)}>
        <button className="text-xs text-red-400 hover:text-red-300">
          Delete tool
        </button>
      </form>
    </div>
  );
}
