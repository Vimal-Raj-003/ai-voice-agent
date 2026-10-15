import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Recent persisted runtime activity (req 13 "Recent History"). Returns the most
// recent error_logs rows; the client filters them to the selected provider and
// renders them in the same table. This is REAL historical traffic from the DB —
// NOT the current live session, and NOT fabricated.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const takeRaw = Number(url.searchParams.get("take") || "400");
  const take = Number.isFinite(takeRaw) ? Math.min(1000, Math.max(50, takeRaw)) : 400;

  try {
    const rows = await prisma.errorLog.findMany({
      orderBy: { timestamp: "desc" },
      take,
      select: { id: true, source: true, level: true, message: true, detail: true, timestamp: true },
    });
    return Response.json({
      rows: rows.map((r) => ({
        id: r.id, source: r.source, level: r.level, message: r.message,
        detail: r.detail, timestamp: r.timestamp.toISOString(),
      })),
    });
  } catch (err) {
    return Response.json({ rows: [], error: err instanceof Error ? err.message : String(err) }, { status: 200 });
  }
}
