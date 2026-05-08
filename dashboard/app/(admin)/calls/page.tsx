import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import {
  Badge,
  directionTone,
  outcomeTone,
  sentimentTone,
  statusTone,
} from "@/components/Badge";
import CallsFilters from "@/components/CallsFilters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { id: orgId } = await getDefaultOrg();

  const q = (sp.q ?? "").trim();
  const direction = sp.direction || undefined;
  const status = sp.status || undefined;
  const outcome = sp.outcome || undefined;
  const assistantId = sp.assistantId || undefined;
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : undefined;
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PAGE_SIZE;

  let idFilter: string[] | null = null;
  let snippetMap: Map<string, string> = new Map();
  if (q) {
    const rows: { call_id: string; snippet: string }[] = await prisma.$queryRaw`
      SELECT DISTINCT ON ("callId")
        "callId" AS call_id,
        substring(content from greatest(1, position(${q} in lower(content)) - 30) for 120) AS snippet
      FROM transcript_messages
      WHERE content ILIKE '%' || ${q} || '%' OR content % ${q}
      ORDER BY "callId", similarity(content, ${q}) DESC
      LIMIT 200
    `;
    idFilter = rows.map((r) => r.call_id);
    snippetMap = new Map(rows.map((r) => [r.call_id, r.snippet]));
    if (idFilter.length === 0) idFilter = ["__none__"];
  }

  const where: Record<string, unknown> = {
    organizationId: orgId,
  };
  if (direction) where.direction = direction;
  if (status) where.status = status;
  if (outcome) where.outcome = outcome;
  if (assistantId) where.assistantId = assistantId;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, Date>).gte = from;
    if (to) (where.createdAt as Record<string, Date>).lte = to;
  }
  if (idFilter) where.id = { in: idFilter };

  const [calls, total, assistants] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: PAGE_SIZE,
    }),
    prisma.call.count({ where }),
    prisma.assistant.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Calls</h1>
      <CallsFilters assistants={assistants} />
      <div className="text-xs text-gray-500">
        {total} call{total === 1 ? "" : "s"}
        {q && ` matching "${q}"`}
      </div>
      <ul className="rounded-2xl border border-white/10 divide-y divide-white/5">
        {calls.length === 0 && (
          <li className="p-6 text-sm text-gray-500 text-center">
            No calls found. {q && "Try clearing filters."}
          </li>
        )}
        {calls.map((c) => {
          const cost = Number(c.costUsd ?? 0);
          return (
            <li key={c.id} className="p-3 hover:bg-white/[0.02]">
              <Link href={`/calls/${c.id}`} className="block">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{c.toNumber}</div>
                    <div className="text-[11px] text-gray-500">
                      {c.createdAt.toLocaleString()}
                      {c.durationSeconds != null && ` · ${c.durationSeconds}s`}
                      {cost > 0 && ` · $${cost.toFixed(4)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={directionTone(c.direction)}>{c.direction.toLowerCase()}</Badge>
                    <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    {c.outcome && <Badge tone={outcomeTone(c.outcome)}>{c.outcome}</Badge>}
                    {c.sentiment && <Badge tone={sentimentTone(c.sentiment)}>{c.sentiment}</Badge>}
                  </div>
                </div>
                {q && snippetMap.has(c.id) && (
                  <div
                    className="mt-2 text-[11px] text-gray-400 italic line-clamp-2"
                    dangerouslySetInnerHTML={{
                      __html: snippetMap
                        .get(c.id)!
                        .replace(
                          new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
                          '<mark class="bg-violet-500/30 text-white">$1</mark>',
                        ),
                    }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <Pagination current={page} total={totalPages} sp={sp} />
      )}
    </div>
  );
}

function Pagination({
  current,
  total,
  sp,
}: {
  current: number;
  total: number;
  sp: Record<string, string | undefined>;
}) {
  const pageUrl = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "page") params.set(k, String(v));
    }
    if (p > 1) params.set("page", String(p));
    return `/calls?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-center gap-1 text-xs">
      {current > 1 && (
        <Link href={pageUrl(current - 1)} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">
          ← prev
        </Link>
      )}
      <span className="px-2 py-1 text-gray-500">
        Page {current} of {total}
      </span>
      {current < total && (
        <Link href={pageUrl(current + 1)} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">
          next →
        </Link>
      )}
    </div>
  );
}
