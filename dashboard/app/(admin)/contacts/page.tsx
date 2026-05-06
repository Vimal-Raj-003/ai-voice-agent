import Link from "next/link";
import { prisma } from "@/lib/prisma";

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
            className="flex items-center justify-between p-4 hover:bg-white/[0.02]"
          >
            <div>
              <div className="font-medium">{c.name || c.phoneNumber}</div>
              <div className="text-xs text-gray-500">
                {c.phoneNumber} · {c.totalCalls} calls ·{" "}
                {c.lastOutcome ?? "—"}
              </div>
            </div>
            {c.isBooked && (
              <span className="text-xs text-green-400">Booked</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
