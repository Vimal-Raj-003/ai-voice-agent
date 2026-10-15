import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Persisted pipeline events for ONE call, by LiveKit room name. The worker's
// structlog events are mirrored into error_logs (observability bridge); their
// `detail` JSON carries room/call_id. We filter by the room string so a SELECTED
// (incl. historical) call's stage breakdown can be recomputed by the SAME
// client-side derive() that powers the live view — no fabricated statuses.
// Read-only; dashboard-side only.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const room = new URL(request.url).searchParams.get("room")?.trim();
  if (!room) return Response.json({ events: [] });

  // error_logs.detail is a JSON string that includes the room name for pipeline
  // events. A substring match pulls exactly this call's events. Bounded + newest
  // first in the query, returned oldest-first so derive() replays them in order.
  const rows = await prisma.errorLog.findMany({
    where: { detail: { contains: room } },
    orderBy: { timestamp: "desc" },
    take: 800,
    select: { id: true, source: true, level: true, message: true, detail: true, timestamp: true },
  });

  return Response.json({
    events: rows.reverse().map((r) => ({
      id: r.id,
      source: r.source,
      level: r.level,
      message: r.message,
      detail: r.detail,
      timestamp: r.timestamp.toISOString(),
    })),
  });
}
