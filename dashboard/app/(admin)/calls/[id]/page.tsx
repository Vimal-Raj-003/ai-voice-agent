import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  Badge,
  directionTone,
  outcomeTone,
  sentimentTone,
  statusTone,
} from "@/components/Badge";
import CallRecording from "@/components/CallRecording";
import CallNotesEditor from "@/components/CallNotesEditor";

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

  const cost = Number(c.costUsd ?? 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{c.toNumber}</h1>
          <Badge tone={directionTone(c.direction)}>
            {c.direction.toLowerCase()}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          {c.outcome && (
            <Badge tone={outcomeTone(c.outcome)}>{c.outcome}</Badge>
          )}
          {c.sentiment && (
            <Badge tone={sentimentTone(c.sentiment)}>{c.sentiment}</Badge>
          )}
          <span className="text-gray-500 text-xs ml-2">
            {c.durationSeconds ?? 0}s
          </span>
          {cost > 0 && (
            <span className="text-gray-500 text-xs">
              · ${cost.toFixed(4)}
            </span>
          )}
          <span className="text-gray-500 text-xs">
            · {c.createdAt.toLocaleString()}
          </span>
        </div>
      </div>

      <CallRecording url={c.recordingUrl} durationSeconds={c.durationSeconds} />

      <CallNotesEditor callId={c.id} initial={c.notes} />

      {c.summary && (
        <section className="glass rounded-2xl p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-2">
            Summary
          </h2>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">
            {c.summary}
          </p>
        </section>
      )}

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
          Transcript
          <span className="ml-2 text-xs text-gray-500 font-normal normal-case">
            {transcript.length} turn{transcript.length === 1 ? "" : "s"}
          </span>
        </h2>
        {transcript.length === 0 ? (
          <p className="text-sm text-gray-500">
            No transcript yet — turns appear here while the call is in progress.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {transcript.map((m) => (
              <li
                key={m.id}
                className={`rounded-xl p-3 ${
                  m.role === "USER"
                    ? "bg-cyan-500/[0.08] border border-cyan-500/20"
                    : m.role === "ASSISTANT"
                    ? "bg-violet-500/[0.08] border border-violet-500/20"
                    : "bg-amber-500/[0.08] border border-amber-500/20"
                }`}
              >
                <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1 font-mono">
                  {m.role.toLowerCase()} · {m.timestamp.toLocaleTimeString()}
                </div>
                {m.content}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
