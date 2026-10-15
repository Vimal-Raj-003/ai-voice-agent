import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Live conversation data for the Voice Pipeline panel, by LiveKit room name.
// Returns the persisted transcript (USER/ASSISTANT turns — redacted text when
// the app redacts), the recording URL (null when recording is not enabled), the
// assistant config, and the call status. Read-only Prisma query; dashboard-side
// only (never in the realtime audio loop). SYSTEM/TOOL rows and prompts are
// excluded; API keys are never involved.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const room = new URL(request.url).searchParams.get("room")?.trim();
  if (!room) return Response.json({ found: false });

  const call = await prisma.call.findUnique({
    where: { livekitRoomName: room },
    select: {
      id: true,
      status: true,
      recordingUrl: true,
      toNumber: true,
      assistant: {
        select: {
          name: true, voiceId: true,
          llmProvider: true, llmModel: true,
          ttsProvider: true, sttProvider: true, sttModel: true,
        },
      },
    },
  });
  if (!call) return Response.json({ found: false });

  const msgs = await prisma.transcriptMessage.findMany({
    where: { callId: call.id, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { timestamp: "asc" },
    take: 300,
    select: { role: true, content: true, contentRedacted: true, timestamp: true },
  });

  return Response.json({
    found: true,
    status: call.status,
    recordingUrl: call.recordingUrl,          // null ⇒ recording not available
    recordingEnabled: Boolean(call.recordingUrl),
    phone: call.toNumber,
    assistant: call.assistant,
    transcript: msgs.map((m) => ({
      // prefer the redacted text (respects the app's PII config); fall back to raw
      speaker: m.role === "USER" ? "CUSTOMER" : "AI",
      text: m.contentRedacted ?? m.content,
      ts: m.timestamp,
    })),
  });
}
