import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  Badge,
  outcomeTone,
  statusTone,
} from "@/components/Badge";
import { updateContact } from "./actions";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

function tagsToCsv(rawTags: string | null | undefined): string {
  if (!rawTags) return "";
  try {
    const parsed = JSON.parse(rawTags);
    return Array.isArray(parsed) ? parsed.join(", ") : "";
  } catch {
    return "";
  }
}

export default async function ContactDetail({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone: rawPhone } = await params;
  const phone = decodeURIComponent(rawPhone);
  const c = await prisma.contact.findUnique({
    where: { phoneNumber: phone },
  });
  if (!c) notFound();
  const memories = await prisma.contactMemory.findMany({
    where: { phoneNumber: phone },
    orderBy: { createdAt: "desc" },
  });
  const calls = await prisma.call.findMany({
    where: { OR: [{ toNumber: phone }, { fromNumber: phone }] },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const tagsCsv = tagsToCsv(c.tags);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">{c.name || c.phoneNumber}</h1>
          {c.isBooked && <Badge tone="success">Booked</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className="font-mono">{c.phoneNumber}</span>
          <span>· {c.totalCalls} call{c.totalCalls === 1 ? "" : "s"}</span>
          {c.lastOutcome && (
            <Badge tone={outcomeTone(c.lastOutcome)}>{c.lastOutcome}</Badge>
          )}
          {c.lastCallAt && (
            <span>· last seen {new Date(c.lastCallAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      <form
        action={updateContact.bind(null, phone)}
        className="glass rounded-2xl p-5 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
              Name
            </span>
            <input
              name="name"
              defaultValue={c.name ?? ""}
              placeholder="Caller name"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
              Email
            </span>
            <input
              name="email"
              type="email"
              defaultValue={c.email ?? ""}
              placeholder="name@example.com"
              className={inputCls}
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Tags <span className="text-gray-600">(comma-separated)</span>
          </span>
          <input
            name="tags"
            defaultValue={tagsCsv}
            placeholder="vip, follow-up"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Notes
          </span>
          <textarea
            name="notes"
            rows={4}
            defaultValue={c.notes ?? ""}
            placeholder="Manual notes about this contact — visible across the CRM."
            className={inputCls + " resize-y"}
          />
        </label>
        <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
          Save contact
        </button>
      </form>

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
          Memory
        </h2>
        {memories.length === 0 ? (
          <p className="text-sm text-gray-500">
            No memory yet — the agent appends insights here as it learns about
            this caller.
          </p>
        ) : (
          <ul className="space-y-2">
            {memories.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-sm"
              >
                <div className="text-[10px] font-mono text-gray-500 mb-1">
                  {m.createdAt.toLocaleString()}
                </div>
                {m.insight}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
          Recent calls
        </h2>
        {calls.length === 0 ? (
          <p className="text-sm text-gray-500">No calls yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {calls.map((cc) => (
              <li
                key={cc.id}
                className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-b-0"
              >
                <span className="text-gray-300">
                  {cc.createdAt.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  {cc.outcome ? (
                    <Badge tone={outcomeTone(cc.outcome)}>{cc.outcome}</Badge>
                  ) : (
                    <Badge tone={statusTone(cc.status)}>{cc.status}</Badge>
                  )}
                  <span className="text-xs text-gray-500">
                    {cc.durationSeconds ?? 0}s
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
