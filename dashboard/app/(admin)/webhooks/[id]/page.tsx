import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateWebhook, deleteWebhook, retryDelivery, replayAllDeadLetters } from "../actions";
import WebhookForm from "@/components/WebhookForm";
import { Badge } from "@/components/Badge";

function deliveryTone(d: { responseCode: number | null; succeededAt: Date | null }) {
  if (d.succeededAt) return "success" as const;
  if (d.responseCode && d.responseCode >= 400) return "danger" as const;
  if (d.responseCode && d.responseCode >= 300) return "warning" as const;
  return "neutral" as const;
}

export default async function WebhookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const w = await prisma.webhook.findUnique({ where: { id } });
  if (!w) notFound();
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const deadLetterCount = await prisma.webhookDelivery.count({
    where: { webhookId: id, status: "DEAD_LETTER" },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold break-all font-mono">{w.url}</h1>
          <Badge tone={w.isActive ? "success" : "muted"}>
            {w.isActive ? "active" : "paused"}
          </Badge>
        </div>
        <p className="text-xs text-gray-500">
          Created {w.createdAt.toLocaleString()} · Updated{" "}
          {w.updatedAt.toLocaleString()}
        </p>
      </div>

      <WebhookForm action={updateWebhook.bind(null, id)} initial={w} />

      <section className="glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300 mb-3">
          Recent deliveries
          <span className="ml-2 text-xs text-gray-500 font-normal normal-case">
            {deliveries.length}
          </span>
        </h2>
        {deadLetterCount > 0 && (
          <form action={replayAllDeadLetters.bind(null, w.id)}>
            <button className="rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 px-3 py-1.5 text-xs mb-3">
              Replay all dead-lettered ({deadLetterCount})
            </button>
          </form>
        )}
        {deliveries.length === 0 ? (
          <p className="text-sm text-gray-500">
            No deliveries yet — voice-service POSTs to this URL when the
            enabled events fire.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {deliveries.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-violet-200">
                    {d.event}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone={
                      d.status === "SUCCESS" ? "success"
                      : d.status === "DEAD_LETTER" ? "danger"
                      : d.status === "RETRY_SCHEDULED" ? "warning"
                      : "muted"
                    }>{d.status}</Badge>
                    <Badge tone={deliveryTone(d)}>
                      {d.responseCode ?? "pending"}
                    </Badge>
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 mt-1 font-mono flex items-center gap-2">
                  <span>
                    {d.createdAt.toLocaleString()} · {d.attemptsMade} attempt
                    {d.attemptsMade === 1 ? "" : "s"}
                    {d.succeededAt
                      ? ` · succeeded ${new Date(d.succeededAt).toLocaleTimeString()}`
                      : ""}
                  </span>
                  {(d.status === "DEAD_LETTER" || d.status === "RETRY_SCHEDULED") && (
                    <form action={retryDelivery.bind(null, d.id)}>
                      <button className="text-xs text-violet-300 hover:text-violet-200">
                        Retry now
                      </button>
                    </form>
                  )}
                </div>
                {d.responseBody && (
                  <pre className="mt-2 text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-all line-clamp-3">
                    {d.responseBody}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={deleteWebhook.bind(null, id)}>
        <button className="text-xs text-red-400 hover:text-red-300">
          Delete webhook
        </button>
      </form>
    </div>
  );
}
