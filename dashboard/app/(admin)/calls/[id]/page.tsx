import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function CallDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await prisma.call.findUnique({ where: { id } });
  if (!c) notFound();
  const transcript = await prisma.transcriptMessage.findMany({
    where: { callId: id },
    orderBy: { timestamp: "asc" },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">{c.toNumber}</h1>
        <div className="text-sm text-gray-500">
          {c.direction} · {c.status} · {c.outcome ?? "—"} ·{" "}
          {c.durationSeconds ?? 0}s · ${Number(c.costUsd ?? 0).toFixed(4)}
        </div>
      </div>
      {c.recordingUrl && (
        <audio controls src={c.recordingUrl} className="w-full">
          Your browser does not support audio.
        </audio>
      )}
      {c.summary && (
        <section className="rounded-2xl bg-white/5 p-4 border border-white/10">
          <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-2">
            Summary
          </h2>
          <p className="text-sm">{c.summary}</p>
        </section>
      )}
      <section>
        <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-2">
          Transcript
        </h2>
        <ul className="space-y-2 text-sm">
          {transcript.length === 0 && (
            <li className="text-gray-500">No transcript available.</li>
          )}
          {transcript.map((m) => (
            <li
              key={m.id}
              className={`rounded-lg p-3 ${
                m.role === "USER"
                  ? "bg-blue-500/10 border border-blue-500/20"
                  : m.role === "ASSISTANT"
                  ? "bg-white/5 border border-white/10"
                  : "bg-yellow-500/10 border border-yellow-500/20"
              }`}
            >
              <div className="text-xs text-gray-500 mb-1">
                {m.role.toLowerCase()} · {m.timestamp.toLocaleTimeString()}
              </div>
              {m.content}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
