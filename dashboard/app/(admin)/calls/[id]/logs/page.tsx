import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Badge, statusTone, directionTone } from "@/components/Badge";
import CallRecording from "@/components/CallRecording";
import CallLogsView from "@/components/CallLogsView";

export const dynamic = "force-dynamic";

const fmtTs = (d: Date | null | undefined) => (d ? d.toLocaleString() : "—");
const dur = (s: number | null | undefined) =>
  s == null ? "—" : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s (${s}s)`;

// Per-call logs view ("View Logs" from the Calls list). Everything here is scoped
// to ONE call: the recording comes from the real Egress/R2 pipeline via
// CallRecording, and the flow/breakpoint/timeline come from this call's own
// room-filtered events. Nothing is fabricated.
export default async function CallLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [c, transcript] = await Promise.all([
    prisma.call.findUnique({ where: { id } }),
    prisma.transcriptMessage.findMany({ where: { callId: id }, orderBy: { timestamp: "asc" } }),
  ]);
  if (!c) notFound();

  // Corroborating evidence for stage scoring (same signals the live panel uses).
  const hasUser = transcript.some((m) => m.role === "USER");
  const hasAI = transcript.some((m) => m.role === "ASSISTANT");
  const connected = c.answeredAt != null || c.status === "COMPLETED" || c.status === "IN_PROGRESS";

  const summary: [string, string][] = [
    ["Phone number", c.toNumber ?? "—"],
    ["From", c.fromNumber ?? "—"],
    ["Call ID", c.id],
    ["Room ID", c.livekitRoomName ?? "—"],
    ["Dispatch ID", c.dispatchId ?? "—"],
    ["SIP call ID", c.sipCallId ?? "—"],
    ["Start time", fmtTs(c.startedAt ?? c.createdAt)],
    ["Answer time", fmtTs(c.answeredAt)],
    ["End time", fmtTs(c.endedAt)],
    ["Total duration", dur(c.durationSeconds)],
    ["Final status", c.status],
    ["Hangup reason", c.endedReason ?? "—"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/calls" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200">
          <ArrowLeft size={14} /> Calls
        </Link>
        <h1 className="text-2xl font-bold">{c.toNumber}</h1>
        <Badge tone={directionTone(c.direction)}>{c.direction.toLowerCase()}</Badge>
        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
        <Link href={`/calls/${c.id}`} className="ml-auto text-xs text-purple-300 hover:underline">
          Full call detail →
        </Link>
      </div>

      {/* ── 1. RECORDING (real Egress → R2, signed play + download) ───── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">Recording</h2>
        <CallRecording callId={c.id} durationSeconds={c.durationSeconds} />
      </section>

      {/* ── 2. CALL SUMMARY ──────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">Call summary</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {summary.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-widest text-gray-500">{k}</dt>
              <dd className="truncate font-mono text-gray-200" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 3 / 4 / 6. FLOW, BREAKPOINT, TIMELINE (this call only) ────── */}
      <CallLogsView
        room={c.livekitRoomName}
        hasUser={hasUser}
        hasAI={hasAI}
        connected={connected}
      />

      {/* ── 5. CONVERSATION ──────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-200">
          Conversation
          <span className="font-mono text-[10px] font-normal text-gray-500">
            {transcript.length} turn{transcript.length === 1 ? "" : "s"}
          </span>
        </h2>
        {transcript.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-gray-500">
            No transcript recorded for this call.
          </div>
        ) : (
          <ul className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            {transcript.map((m) => (
              <li key={m.id} className="text-xs">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">
                  {m.role === "USER" ? "Caller" : m.role === "ASSISTANT" ? "Assistant" : m.role.toLowerCase()}
                  {" · "}{m.timestamp.toLocaleTimeString()}
                </div>
                <div className={m.role === "USER" ? "text-sky-200" : m.role === "ASSISTANT" ? "text-emerald-200" : "text-gray-400"}>
                  {m.contentRedacted && m.contentRedacted !== m.content ? (
                    <span title="Redacted">{m.contentRedacted}</span>
                  ) : (
                    m.content
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
