import { voiceService } from "@/lib/voice-service";
import { auth } from "@/lib/auth";

// Middleware skips /api/demo/proxy, so the session is checked here before
// a voice-agent session is spawned (this costs paid API usage).
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const t = await voiceService.demoToken();
    return Response.json(t);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json({ error: msg }, { status: 502 });
  }
}
