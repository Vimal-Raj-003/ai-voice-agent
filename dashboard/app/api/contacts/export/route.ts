import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// Streams every contact row out as a CSV download.
// Header columns are stable so the same file can be re-imported via the
// importContactsCsv server action without manual editing.
//
// Auth: middleware excludes /api/* from session checks (so the SSE / LiveKit
// proxies keep working without a cookie). This route therefore enforces auth
// inline — anyone hitting the URL without a NextAuth session gets a 401.

function escapeCell(v: string | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const rows = await prisma.contact.findMany({
    orderBy: { lastCallAt: "desc" },
  });
  const header = [
    "phone",
    "name",
    "email",
    "notes",
    "tags",
    "total_calls",
    "last_outcome",
    "is_booked",
    "last_call_at",
    "created_at",
  ];
  const lines = [header.join(",")];
  for (const c of rows) {
    lines.push(
      [
        c.phoneNumber,
        c.name,
        c.email,
        c.notes,
        c.tags,
        String(c.totalCalls),
        c.lastOutcome,
        c.isBooked ? "true" : "false",
        c.lastCallAt ? new Date(c.lastCallAt).toISOString() : "",
        new Date(c.createdAt).toISOString(),
      ]
        .map(escapeCell)
        .join(","),
    );
  }
  const csv = lines.join("\n") + "\n";
  const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
