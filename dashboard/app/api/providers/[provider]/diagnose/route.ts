import { auth } from "@/lib/auth";

const URL_BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

// Proxy: run ONE real safe diagnostic against a provider in the voice-service
// (where the API keys live) and return the structured request→response→result.
// Session-gated; the bearer token stays server-side. A new diagnostic runs on
// every call (the UI debounces double-clicks / disables while in flight).
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { provider } = await ctx.params;
  let action = "safe";
  try {
    const body = await request.json();
    if (body && typeof body.action === "string") action = body.action;
  } catch { /* no body → safe */ }

  try {
    const r = await fetch(`${URL_BASE}/api/diagnostics/${encodeURIComponent(provider)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const data = await r.json().catch(() => ({ status: "failed", error: "invalid response from voice service" }));
    return Response.json(data, { status: r.ok ? 200 : r.status });
  } catch (err) {
    // The voice service itself is unreachable — that IS the diagnostic result.
    return Response.json({
      provider, status: "failed", traffic_type: "diagnostic", steps: [],
      breakpoint: "diagnostic_backend", root_cause: "voice service unreachable",
      impact: "Cannot run diagnostics — the voice API is down.",
      error: err instanceof Error ? err.message : String(err),
    }, { status: 200 });
  }
}
