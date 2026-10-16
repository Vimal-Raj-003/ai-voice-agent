import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { Badge } from "@/components/Badge";
import { removeDndNumber } from "@/app/(admin)/dnd/actions";

// Do-Not-Call management, rendered as a SECTION of the Contacts page.
//
// This is the former /dnd page body moved verbatim — same markup, same styling,
// same server action (removeDndNumber), same "Add number" and "Export CSV"
// endpoints, and the same requireRole("ADMIN") gate. Nothing about DNC
// validation, normalisation or outbound blocking enforcement is touched; this
// only changes WHERE the list is displayed.
//
// It stays a SERVER component on purpose: the list is read with prisma and the
// Remove button posts a server action. Re-housing it in a client-side panel
// would have meant re-implementing both, which is exactly what we must not do.
export default async function DncSection() {
  await requireRole("ADMIN");
  const rows = await prisma.dndNumber.findMany({
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Do-Not-Call list</h2>
          <p className="text-sm text-gray-500 mt-1">
            Numbers on this list are blocked from outbound dispatch and
            return BLOCKED status on campaign targets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/dnd/new"
            className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium"
          >
            Add number
          </Link>
          <Link
            href="/contacts"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-gray-300 transition hover:bg-white/[0.07] hover:text-white"
          >
            <ArrowLeft size={14} /> Close
          </Link>
        </div>
      </div>
      <a
        href="/api/dnd/export"
        className="text-xs text-gray-400 hover:text-white"
      >
        Export CSV
      </a>
      <ul className="rounded-2xl border border-white/10 divide-y divide-white/5">
        {rows.length === 0 && (
          <li className="p-4 text-sm text-gray-500">No numbers on the list.</li>
        )}
        {rows.map((r) => (
          <li
            key={r.id}
            className="p-3 flex items-center justify-between gap-3"
          >
            <div>
              <div className="font-mono text-sm">{r.phoneE164}</div>
              <div className="text-xs text-gray-500">
                {r.reason || "—"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone="violet">{r.source}</Badge>
              <span className="text-[10px] text-gray-500">
                {r.createdAt.toLocaleDateString()}
              </span>
              <form action={removeDndNumber.bind(null, r.id)}>
                <button className="text-xs text-red-400 hover:text-red-300">
                  Remove
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
