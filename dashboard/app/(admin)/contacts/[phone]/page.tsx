import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function ContactDetail({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone: rawPhone } = await params;
  const phone = decodeURIComponent(rawPhone);
  const c = await prisma.contact.findUnique({ where: { phoneNumber: phone } });
  if (!c) notFound();
  const memories = await prisma.contactMemory.findMany({
    where: { phoneNumber: phone },
    orderBy: { createdAt: "desc" },
  });
  const calls = await prisma.call.findMany({
    where: { OR: [{ toNumber: phone }, { fromNumber: phone }] },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{c.name || c.phoneNumber}</h1>
        <div className="text-sm text-gray-500">
          {c.phoneNumber} · {c.totalCalls} calls · last outcome{" "}
          {c.lastOutcome ?? "—"}
        </div>
      </div>
      <section>
        <h2 className="text-lg font-semibold mb-2">Memory</h2>
        <ul className="space-y-2">
          {memories.length === 0 && (
            <li className="text-gray-500 text-sm">No memory yet.</li>
          )}
          {memories.map((m) => (
            <li
              key={m.id}
              className="rounded-lg bg-white/5 border border-white/10 p-3 text-sm"
            >
              <div className="text-xs text-gray-500 mb-1">
                {m.createdAt.toLocaleString()}
              </div>
              {m.insight}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Recent calls</h2>
        <ul className="space-y-1 text-sm">
          {calls.length === 0 && (
            <li className="text-gray-500">No calls yet.</li>
          )}
          {calls.map((cc) => (
            <li
              key={cc.id}
              className="flex justify-between border-b border-white/5 py-1"
            >
              <span>{cc.createdAt.toLocaleString()}</span>
              <span className="text-gray-400">
                {cc.outcome ?? cc.status} · {cc.durationSeconds ?? 0}s
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
