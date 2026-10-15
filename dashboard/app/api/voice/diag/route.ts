import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Structured diagnostic ingest for CLIENT-SIDE pipeline events (the Calls page
// dialer). Browser/API/dispatch failures that happen BEFORE a LiveKit room (or
// a worker) exists never reach the worker's structlog→error_logs bridge — so
// without this route a "Fetch failed" / 504 on the Calls page would leave the
// Voice Pipeline Diagnostics showing "Idle / No active call".
//
// This writes one row into the SAME error_logs table the worker bridges into,
// so the existing /api/logs/stream SSE relays it to the diagnostics page with
// no duplicate architecture. `message` = event name, `detail` = the full
// structured JSON (call_attempt_id, stage, reason, error_type, http_status, …).
// The detail JSON embeds `room`/`call_attempt_id` so /api/voice/events can pull
// a selected call's history by substring, exactly like worker events.
//
// SECURITY: session-gated; never stores secrets (the caller only sends phone,
// assistant name, stage, reason, status codes — never tokens or keys).

const ALLOWED = new Set([
  "call_attempt_started",
  "voice_api_ok",
  "dispatch_ok",
  "call_failed",
  "call_canceled_by_user",
]);

const LEVELS = new Set(["INFO", "WARNING", "ERROR"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  if (!ALLOWED.has(name)) {
    return Response.json({ error: "unknown event" }, { status: 400 });
  }

  const level = LEVELS.has(String(body.level)) ? String(body.level) : "INFO";

  // Build the structured detail payload. Only known, non-secret fields pass
  // through; everything is coerced to a safe primitive and bounded in size.
  const str = (v: unknown, max = 500) => {
    if (v == null) return undefined;
    const s = String(v);
    return s.length ? s.slice(0, max) : undefined;
  };
  const int = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  };

  const detail: Record<string, unknown> = {
    source: "dashboard.dialer",
    call_attempt_id: str(body.call_attempt_id, 80),
    room: str(body.room, 120),
    stage: str(body.stage, 40),
    status: str(body.status, 40),
    reason: str(body.reason),
    error_type: str(body.error_type, 80),
    http_status: int(body.http_status),
    provider_code: str(body.provider_code, 120),
    last_successful: str(body.last_successful, 120),
    next_expected: str(body.next_expected, 120),
    phone: str(body.phone, 32),
    assistant: str(body.assistant, 120),
    elapsed_ms: int(body.elapsed_ms),
    ts_client: str(body.ts, 40),
  };
  // Drop undefined keys so the JSON stays compact and clean.
  for (const k of Object.keys(detail)) if (detail[k] === undefined) delete detail[k];

  const message = str(body.reason, 300) || name;

  try {
    const row = await prisma.errorLog.create({
      data: {
        source: "dashboard.dialer",
        level: level as "INFO" | "WARNING" | "ERROR",
        message: name, // event name — diagnostics derive() switches on this
        detail: JSON.stringify({ ...detail, message }),
      },
      select: { id: true },
    });
    return Response.json({ ok: true, id: row.id });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
