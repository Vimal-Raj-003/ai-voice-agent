import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { removeDndNumber } from "./actions";

export const dynamic = "force-dynamic";

export default async function DndPage() {
  await requireRole("ADMIN");
  const rows = await prisma.dndNumber.findMany({
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Do-Not-Call list</h1>
          <p className="text-sm text-gray-500 mt-1">
            Numbers on this list are blocked from outbound dispatch and
            return BLOCKED status on campaign targets.
          </p>
        </div>
        <Link
          href="/dnd/new"
          className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium"
        >
          Add number
        </Link>
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
