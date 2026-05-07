import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { PhoneCall } from "lucide-react";
import {
  Badge,
  directionTone,
  outcomeTone,
  sentimentTone,
  statusTone,
} from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

type Search = {
  outcome?: string;
  status?: string;
  phone?: string;
  page?: string;
};

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const { id: orgId } = await getDefaultOrg();
  const page = Math.max(1, Number(sp.page || 1));
  const limit = 25;
  const where = {
    organizationId: orgId,
    ...(sp.outcome ? { outcome: sp.outcome as any } : {}),
    ...(sp.status ? { status: sp.status as any } : {}),
    ...(sp.phone
      ? {
          OR: [
            { toNumber: { contains: sp.phone } },
            { fromNumber: { contains: sp.phone } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.call.count({ where }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Calls</h1>
      <form className="flex gap-2 text-sm flex-wrap">
        <input
          name="phone"
          placeholder="phone…"
          defaultValue={sp.phone ?? ""}
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
        />
        <select
          name="outcome"
          defaultValue={sp.outcome ?? ""}
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
        >
          <option value="">All outcomes</option>
          {[
            "BOOKED",
            "NOT_INTERESTED",
            "WRONG_NUMBER",
            "VOICEMAIL",
            "NO_ANSWER",
            "CALLBACK_REQUESTED",
            "TRANSFERRED",
            "FAILED",
            "COMPLETED",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
        >
          <option value="">All statuses</option>
          {[
            "QUEUED",
            "RINGING",
            "IN_PROGRESS",
            "COMPLETED",
            "FAILED",
            "NO_ANSWER",
            "BUSY",
            "CANCELED",
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <button className="rounded-lg bg-white text-black px-3 py-1.5 font-medium">
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No calls found"
          description={
            sp.phone || sp.outcome || sp.status
              ? "No calls match your current filters — try clearing them."
              : "When calls come in or go out, they appear here with transcripts, recordings, sentiment, and cost."
          }
          action={{ href: "/demo", label: "Try the demo widget" }}
        />
      ) : (
      <div className="glass rounded-2xl divide-y divide-white/5">
        {rows.map((c) => {
          const cost = Number(c.costUsd ?? 0);
          return (
            <Link
              key={c.id}
              href={`/calls/${c.id}`}
              className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.02]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.toNumber}</span>
                  <Badge tone={directionTone(c.direction)}>
                    {c.direction.toLowerCase()}
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  {c.outcome && (
                    <Badge tone={outcomeTone(c.outcome)}>{c.outcome}</Badge>
                  )}
                  {c.sentiment && (
                    <Badge tone={sentimentTone(c.sentiment)}>
                      {c.sentiment}
                    </Badge>
                  )}
                  <span className="text-xs text-gray-500">
                    {c.durationSeconds ?? 0}s
                  </span>
                  {cost > 0 && (
                    <span className="text-xs text-gray-500">
                      · ${cost.toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-xs text-gray-500">
                {c.createdAt.toLocaleString()}
              </span>
            </Link>
          );
        })}
      </div>
      )}
      <div className="text-xs text-gray-500">
        Page {page} · {total} total
      </div>
    </div>
  );
}
