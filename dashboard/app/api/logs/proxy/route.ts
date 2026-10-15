import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const URL_BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

// Middleware skips /api/logs/proxy (so EventSource works), so the session is
// checked here. The browser's session cookie is sent automatically on this
// same-origin request. TOKEN stays server-side and is never returned.
//
// PRIMARY path: stream the voice-service SSE (it polls error_logs and adds live
// worker events). FALLBACK path: if the voice service is unreachable (its API
// is down — which is itself a failure the operator must still SEE), stream the
// SAME error_logs rows directly from the database via Prisma, in the identical
// SSE shape. This guarantees the Voice Pipeline Diagnostics never goes blank
// when the voice API is the thing that failed, and that browser/API failures
// written by /api/voice/diag always surface.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const level = url.searchParams.get("level") || undefined;
  const source = url.searchParams.get("source") || undefined;
  // Live-session cursor: don't replay rows at/before this ISO timestamp (req 14).
  const sinceParam = url.searchParams.get("since");
  const sinceMs = sinceParam ? Date.parse(sinceParam) : NaN;

  // Try the voice-service SSE first. The 4s timeout must guard ONLY the initial
  // connection — NOT the lifetime of the piped stream. Using
  // `AbortSignal.timeout(4000)` directly as the fetch signal would stay armed
  // after we return `upstream.body`, aborting the long-lived SSE ~4s in (the
  // proxy then 500s and the browser loses all backend events). So use a manual
  // controller and CLEAR the timer the moment the connection is established.
  try {
    const ac = new AbortController();
    const connectTimer = setTimeout(() => ac.abort(), 4000);
    const upstream = await fetch(`${URL_BASE}/api/logs/stream${qs ? "?" + qs : ""}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: ac.signal,
    });
    if (upstream.ok && upstream.body) {
      clearTimeout(connectTimer); // connected → let the stream live indefinitely
      return new Response(upstream.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Logs-Source": "voice-service",
        },
      });
    }
    clearTimeout(connectTimer);
  } catch {
    /* fall through to the DB-backed stream below */
  }

  // FALLBACK: DB-backed SSE. Polls error_logs every 2s and emits new rows
  // (timestamp > last_seen) exactly like the voice-service stream does.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Seed from `since` so a fresh live session doesn't replay history.
      let lastSeen: number | null = Number.isFinite(sinceMs) ? sinceMs : null;
      let hbTicks = 0;
      let closed = false;
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // Tell the client (dev only) which path served it.
      send("heartbeat", { ts: new Date().toISOString(), via: "db-fallback" });

      request.signal.addEventListener("abort", () => { closed = true; });

      while (!closed) {
        try {
          const rows = await prisma.errorLog.findMany({
            where: {
              ...(level ? { level: level as "INFO" | "WARNING" | "ERROR" | "CRITICAL" } : {}),
              ...(source ? { source } : {}),
            },
            orderBy: { timestamp: "desc" },
            take: 20,
            select: { id: true, source: true, level: true, message: true, detail: true, timestamp: true },
          });
          rows.reverse();
          let sent = 0;
          for (const r of rows) {
            const ms = r.timestamp.getTime();
            if (lastSeen != null && ms <= lastSeen) continue;
            lastSeen = ms;
            sent += 1;
            send("log", {
              id: r.id, source: r.source, level: r.level,
              message: r.message, detail: r.detail,
              timestamp: r.timestamp.toISOString(),
            });
          }
          hbTicks = sent ? 0 : hbTicks + 1;
          if (hbTicks >= 8) { hbTicks = 0; send("heartbeat", { ts: new Date().toISOString(), via: "db-fallback" }); }
        } catch (err) {
          try { send("error", String(err instanceof Error ? err.message : err)); } catch { /* client gone */ }
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Logs-Source": "db-fallback",
    },
  });
}
