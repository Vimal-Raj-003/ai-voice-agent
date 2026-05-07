import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge, outcomeTone } from "@/components/Badge";

export default async function ContactsPage() {
  const rows = await prisma.contact.findMany({
    orderBy: { lastCallAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Contacts</h1>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && (
          <div className="p-6 text-gray-500">No contacts yet.</div>
        )}
        {rows.map((c) => (
          <Link
            key={c.phoneNumber}
            href={`/contacts/${encodeURIComponent(c.phoneNumber)}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{c.name || c.phoneNumber}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-500">{c.phoneNumber}</span>
                <span className="text-xs text-gray-500">
                  · {c.totalCalls} call{c.totalCalls === 1 ? "" : "s"}
                </span>
                {c.lastOutcome && (
                  <Badge tone={outcomeTone(c.lastOutcome)}>
                    {c.lastOutcome}
                  </Badge>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {c.isBooked && <Badge tone="success">Booked</Badge>}
              <span className="text-xs text-gray-500">
                {c.lastCallAt
                  ? new Date(c.lastCallAt).toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
