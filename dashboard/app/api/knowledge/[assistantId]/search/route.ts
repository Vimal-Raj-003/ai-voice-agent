import { auth } from "@/lib/auth";

// "Test Knowledge Search" — a read-only preview of what the voice agent would
// retrieve for a question.
//
// This forwards to the SAME voice-service endpoint the agent's own retrieval
// uses (knowledge.search), so the ranking, the vector operator and the
// similarity floor are production's, not a reimplementation. It is deliberately
// scoped to the assistant and NOT to one source: production searches the whole
// assistant, so filtering by source here would show something the agent would
// never actually do. The response says which source each hit came from.
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

type Ctx = { params: Promise<{ assistantId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { assistantId } = await ctx.params;
  let body: { query?: string; top_k?: number; answer?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is treated as an empty query below */
  }
  const query = (body.query || "").trim().slice(0, 1000);
  if (!query) return Response.json({ error: "Enter a question to test." }, { status: 400 });
  // A preview may look a little wider than a call does (which uses 4) so the
  // operator can see the near-misses too; the similarity floor is unchanged.
  const topK = Math.min(20, Math.max(1, Number(body.top_k ?? 8) || 8));

  try {
    const r = await fetch(
      `${BASE}/api/knowledge/${encodeURIComponent(assistantId)}/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        },
        // `answer` asks the voice-service to also draft a grounded answer from
        // the retrieved chunks, so the operator sees what a caller would hear.
        body: JSON.stringify({ query, top_k: topK, answer: body.answer !== false }),
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
      },
    );
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
