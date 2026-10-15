import { auth } from "@/lib/auth";

// System-health probe for the Voice Pipeline diagnostics panel. Proxies the
// voice-service /health (which is DB-gated) so the dashboard can show VOICE API
// + DATABASE status. No secrets returned. Read-only; never touches the call loop.
const URL_BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await fetch(`${URL_BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    let body: { status?: string } = {};
    try { body = await r.json(); } catch { /* non-JSON */ }
    const dbOk = r.ok && body.status === "ok";
    return Response.json({ api: r.ok ? "ok" : "down", database: dbOk ? "ok" : "down" });
  } catch {
    // Connection refused / timeout ⇒ the FastAPI voice API is not running.
    return Response.json({ api: "offline", database: "unknown" });
  }
}
