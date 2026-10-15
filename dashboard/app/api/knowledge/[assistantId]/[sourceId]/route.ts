import { auth } from "@/lib/auth";

// Sync (POST) and Delete (DELETE) for one knowledge source. Both carry the
// assistantId, so the voice service can scope the operation to that assistant.
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

async function forward(path: string, method: string) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  try {
    return Response.json(JSON.parse(text), { status: r.status });
  } catch {
    return Response.json({ error: text.slice(0, 300) }, { status: r.status || 502 });
  }
}

type Ctx = { params: Promise<{ assistantId: string; sourceId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assistantId, sourceId } = await ctx.params;
  try {
    return await forward(
      `/api/knowledge/${encodeURIComponent(assistantId)}/sources/${encodeURIComponent(sourceId)}/sync`,
      "POST");
  } catch (e) {
    return Response.json({ error: `voice service unreachable: ${e}` }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assistantId, sourceId } = await ctx.params;
  try {
    return await forward(
      `/api/knowledge/${encodeURIComponent(assistantId)}/sources/${encodeURIComponent(sourceId)}`,
      "DELETE");
  } catch (e) {
    return Response.json({ error: `voice service unreachable: ${e}` }, { status: 502 });
  }
}
