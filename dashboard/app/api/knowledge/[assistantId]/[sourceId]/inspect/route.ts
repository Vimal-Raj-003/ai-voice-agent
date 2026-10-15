import { auth } from "@/lib/auth";

// READ-ONLY inspection for one knowledge source ("View Indexed Data").
//
// One route with an allowlisted `view` rather than four near-identical files.
// GET only — nothing here can change stored knowledge; Re-index and Delete stay
// on the existing [sourceId] route.
//
// Both ids are always forwarded together: the voice service scopes every query
// by assistant_id AND source_id, so a source id from another assistant 404s
// instead of returning its content.
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

/** view -> path suffix under /sources/{id}. Anything else is rejected. */
const VIEWS: Record<string, string> = {
  detail: "",
  pages: "/pages",
  chunks: "/chunks",
};

type Ctx = { params: Promise<{ assistantId: string; sourceId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { assistantId, sourceId } = await ctx.params;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "detail";

  const a = encodeURIComponent(assistantId);
  const s = encodeURIComponent(sourceId);
  let path: string;

  if (view === "vector") {
    // The raw embedding, fetched only when the operator explicitly expands it.
    const chunkId = url.searchParams.get("chunkId") || "";
    if (!chunkId) return Response.json({ error: "chunkId is required" }, { status: 400 });
    path = `/api/knowledge/${a}/sources/${s}/chunks/${encodeURIComponent(chunkId)}/vector`;
  } else if (view in VIEWS) {
    path = `/api/knowledge/${a}/sources/${s}${VIEWS[view]}`;
    if (view === "chunks") {
      // Pagination and filter pass straight through, clamped server-side.
      const qs = new URLSearchParams();
      qs.set("offset", String(Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0)));
      qs.set("limit", String(Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20))));
      const q = (url.searchParams.get("q") || "").slice(0, 200);
      if (q) qs.set("q", q);
      path += `?${qs}`;
    }
  } else {
    return Response.json({ error: `unknown view "${view}"` }, { status: 400 });
  }

  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
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
