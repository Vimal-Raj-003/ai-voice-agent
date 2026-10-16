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
import PhoneDialer from "@/components/PhoneDialer";

// Call history, rendered as a SECTION of the Contacts page.
//
// The former /calls page body moved verbatim: same org-scoped query, same
// transcript search (raw SQL + snippet highlight), same direction/status/
// outcome/date filters, same pagination, same badges, cost and duration, and
// the same inline PhoneDialer for the INBOUND view.
//
// Deep links are deliberately NOT rewritten: a row still links to /calls/[id]
// and "View Logs" still links to /calls/[id]/logs, so every existing bookmark,
// call id and log route keeps working. Only the index listing moved.
//
// BASE_PATH/SECTION are threaded through the filter bar and pagination so
// filtering, clearing and paging stay inside Contacts instead of bouncing back
// to the old route.
const BASE_PATH = "/contacts";
const SECTION = { section: "calls" };

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function CallsSection({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const sp = searchParams;
  const { id: orgId } = await getDefaultOrg();

  // Only search + direction remain as filters. The status / outcome / date
  // controls were removed from the UI, so their params are deliberately NOT
  // read any more: honouring a leftover ?status=FAILED would keep filtering the
  // list with no control left to clear it. The backend status and outcome
  // values are untouched and still shown as badges on each row.
  const q = (sp.q ?? "").trim();
  const direction = sp.direction || undefined;
  const page = Math.max(1, Number(sp.page || 1));
  const offset = (page - 1) * PAGE_SIZE;

  let idFilter: string[] | null = null;
  let snippetMap: Map<string, string> = new Map();
  if (q) {
    const rows: { call_id: string; snippet: string }[] = await prisma.$queryRaw`
      SELECT DISTINCT ON ("callId")
        "callId" AS call_id,
        substring(content from greatest(1, position(lower(${q}) in lower(content)) - 30) for 120) AS snippet
      FROM transcript_messages
      WHERE content ILIKE '%' || ${q} || '%'
      ORDER BY "callId"
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
  if (idFilter) where.id = { in: idFilter };

  const [calls, total, dialerAssistants] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: PAGE_SIZE,
    }),
    prisma.call.count({ where }),
    // Active assistants for the dialer dropdown, with the fields it shows as a
    // secondary label (provider · model · tts/voice).
    prisma.assistant.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        llmProvider: true,
        llmModel: true,
        ttsProvider: true,
        voiceId: true,
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Calls</h2>
      <CallsFilters basePath={BASE_PATH} keep={SECTION} />
      {direction === "INBOUND" && <PhoneDialer assistants={dialerAssistants} />}
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
             <div className="flex items-start gap-3">
              <Link href={`/calls/${c.id}`} className="block min-w-0 flex-1">
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
              {/* Per-call logs: recording, flow, breakpoint, timeline. Kept
                  OUTSIDE the row <Link> so anchors are never nested. */}
              <Link
                href={`/calls/${c.id}/logs`}
                className="shrink-0 self-center rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/10 hover:text-white"
              >
                View Logs
              </Link>
             </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <Pagination
          current={page}
          total={totalPages}
          // q + direction only, so a stale status/date in the URL is not
          // propagated into the page links.
          sp={{ ...(q ? { q } : {}), ...(direction ? { direction } : {}), ...SECTION }}
        />
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
    return `${BASE_PATH}?${params.toString()}`;
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
