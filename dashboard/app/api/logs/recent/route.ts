import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Recent persisted events, for seeding the Live Logs view on load/refresh.
//
// WHY: the SSE stream intentionally starts at the current session boundary so a
// fresh page is not flooded with history. The side effect was that a refresh
// showed an empty page even though tens of thousands of rows were retained —
// the operator had no way to tell "nothing is happening" from "ingestion is
// broken". This gives the page a bounded replay from the durable store rather
// than relying on in-browser memory.
//
// Auth: this route sits behind the dashboard's existing middleware session
// check, same as every other /api/logs route. It reads only error_logs and
// mutates nothing.
const MAX = 200;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, MAX);
  const level = url.searchParams.get("level") ?? undefined;

  try {
    const rows = await prisma.errorLog.findMany({
      where: level ? { level: level as "INFO" } : undefined,
      orderBy: { timestamp: "desc" },
      take: limit,
      select: { id: true, source: true, level: true, message: true, detail: true, timestamp: true },
    });
    return NextResponse.json({
      ok: true,
      // Oldest-first so the client can append in chronological order.
      events: rows.reverse().map((r) => ({
        id: r.id,
        source: r.source,
        level: r.level,
        message: r.message,
        detail: r.detail,
        // Always an explicit UTC instant: the column is naive UTC, and a bare
        // "YYYY-MM-DDTHH:MM:SS" is parsed as LOCAL time by the browser.
        timestamp: r.timestamp.toISOString(),
        replayed: true,
      })),
    });
  } catch (err) {
    // The page must be able to say "event source unhealthy" rather than
    // silently showing zero.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "log store unreachable", events: [] },
      { status: 503 },
    );
  }
}
