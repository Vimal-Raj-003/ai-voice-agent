import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Recent real telephony calls for the Voice Pipeline timeline graph. Read-only
// Prisma query (dashboard-side only; never in the realtime audio loop). Returns
// just what the timeline + tooltip + selection need — the per-stage breakdown
// for a selected call is computed separately from that call's own events
// (/api/voice/events), so nothing here is fabricated.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const limit = Math.min(100, Number(new URL(request.url).searchParams.get("limit")) || 40);

  const calls = await prisma.call.findMany({
    where: { livekitRoomName: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      livekitRoomName: true,
      status: true,
      outcome: true,
      toNumber: true,
      createdAt: true,
      startedAt: true,
      answeredAt: true,
      endedAt: true,
      durationSeconds: true,
      assistant: { select: { name: true, voiceId: true, llmProvider: true, llmModel: true, ttsProvider: true, sttProvider: true } },
    },
  });

  return Response.json({
    calls: calls.map((c) => ({
      id: c.id,
      room: c.livekitRoomName,
      status: c.status,            // QUEUED | RINGING | IN_PROGRESS | COMPLETED | FAILED | NO_ANSWER | BUSY | CANCELED
      outcome: c.outcome ?? null,
      phone: c.toNumber,
      assistant: c.assistant?.name ?? null,
      voice: c.assistant?.voiceId ?? null,
      llm: c.assistant?.llmProvider ?? null,
      llmModel: c.assistant?.llmModel ?? null,
      stt: c.assistant?.sttProvider ?? null,
      tts: c.assistant?.ttsProvider ?? null,
      createdAt: (c.answeredAt ?? c.startedAt ?? c.createdAt)?.toISOString() ?? null,
      endedAt: c.endedAt?.toISOString() ?? null,
      durationSeconds: c.durationSeconds ?? (c.endedAt && c.startedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : null),
    })),
  });
}
