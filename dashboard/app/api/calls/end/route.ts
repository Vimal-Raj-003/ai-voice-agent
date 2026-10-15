import { voiceService } from "@/lib/voice-service";
import { auth } from "@/lib/auth";

// End an in-progress outbound call (deletes its LiveKit room → drops SIP + agent).
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const room = String(body?.room || "").trim();
  if (!room) {
    return Response.json({ error: "room is required" }, { status: 400 });
  }
  try {
    const r = await voiceService.endCall(room);
    return Response.json(r);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json({ error: msg }, { status: 502 });
  }
}
