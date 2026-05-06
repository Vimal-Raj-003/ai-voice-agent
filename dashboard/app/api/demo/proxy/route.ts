import { voiceService } from "@/lib/voice-service";

export async function POST() {
  try {
    const t = await voiceService.demoToken();
    return Response.json(t);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json({ error: msg }, { status: 502 });
  }
}
