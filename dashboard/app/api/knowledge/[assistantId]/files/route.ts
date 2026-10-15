import { auth } from "@/lib/auth";

// File upload proxy. Streams the multipart body straight through to the voice
// service, which owns validation, storage and extraction. The assistantId stays
// in the path so an upload can never land under another assistant.
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

export async function POST(req: Request, ctx: { params: Promise<{ assistantId: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { assistantId } = await ctx.params;

  // Forward the original multipart body and its boundary untouched.
  const body = await req.arrayBuffer();
  const contentType = req.headers.get("content-type") || "multipart/form-data";
  try {
    const r = await fetch(`${BASE}/api/knowledge/${encodeURIComponent(assistantId)}/files`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      body,
      cache: "no-store",
      // Extraction/OCR happen in the background, but a large upload still needs
      // time to transfer.
      signal: AbortSignal.timeout(180000),
    });
    const text = await r.text();
    try {
      return Response.json(JSON.parse(text), { status: r.status });
    } catch {
      return Response.json({ error: text.slice(0, 300) }, { status: r.status || 502 });
    }
  } catch (e) {
    return Response.json({ error: `voice service unreachable: ${e}` }, { status: 502 });
  }
}
