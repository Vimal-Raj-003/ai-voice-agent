import { voiceService } from "@/lib/voice-service";
import { auth } from "@/lib/auth";

// Mint a read-only LiveKit token so the Calls-page dialer can join an existing
// outbound call room as a passive listener (live state + audio monitor).
// Session-checked here; the VOICE_SERVICE_TOKEN stays server-side.
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
    const t = await voiceService.monitorToken(room);
    return Response.json(t);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json({ error: msg }, { status: 502 });
  }
}
