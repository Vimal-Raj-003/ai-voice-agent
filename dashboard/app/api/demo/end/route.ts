import { voiceService } from "@/lib/voice-service";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { room } = body;
    if (!room) {
      return Response.json({ error: "Room name is required." }, { status: 400 });
    }
    const res = await voiceService.endCall(room);
    return Response.json(res);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json({ error: msg }, { status: 500 });
  }
}
