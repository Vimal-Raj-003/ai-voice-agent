import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Users } from "lucide-react";
import { Badge, outcomeTone } from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import ContactsCsv from "@/components/ContactsCsv";

export default async function ContactsPage() {
  const rows = await prisma.contact.findMany({
    orderBy: { lastCallAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="text-sm text-gray-400 mt-1">
            CSV header expected: <code className="text-[10px] font-mono">phone,name,email,notes,tags</code>{" "}
            — only <code className="text-[10px] font-mono">phone</code> is required.
          </p>
        </div>
        <ContactsCsv />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Contacts are populated automatically when calls happen — once your first call completes, the contact row appears here with full history and memory."
        />
      ) : (
      <div className="glass rounded-2xl divide-y divide-white/5">
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
      )}
    </div>
  );
}
