import { auth } from "@/lib/auth";

// URL Setup proxy. The voice service owns crawling, embedding and search; this
// route only forwards an authenticated admin's request and keeps the
// assistantId in the path so a source can never be read or written across
// assistants.
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

async function forward(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
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

export async function GET(_req: Request, ctx: { params: Promise<{ assistantId: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assistantId } = await ctx.params;
  try {
    return await forward(`/api/knowledge/${encodeURIComponent(assistantId)}/sources`);
  } catch (e) {
    return Response.json({ sources: [], error: `voice service unreachable: ${e}` }, { status: 200 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ assistantId: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assistantId } = await ctx.params;
  const body = await req.text();
  try {
    return await forward(`/api/knowledge/${encodeURIComponent(assistantId)}/sources`,
      { method: "POST", body });
  } catch (e) {
    return Response.json({ error: `voice service unreachable: ${e}` }, { status: 502 });
  }
}
