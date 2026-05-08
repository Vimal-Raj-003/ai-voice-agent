import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("unauthorized", { status: 401 });
  const rows = await prisma.dndNumber.findMany({
    orderBy: { phoneE164: "asc" },
  });
  const lines = ["phone,reason,source,created_at"];
  for (const r of rows) {
    const reason = (r.reason || "").replace(/"/g, '""');
    lines.push(`"${r.phoneE164}","${reason}","${r.source}","${r.createdAt.toISOString()}"`);
  }
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="dnd-list.csv"`,
    },
  });
}
