import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {getDefaultOrg} from "@/lib/org";
import {buildRateMap,callChannel,computeCallCost,voiceUsage} from "@/lib/cost";

// Recent real telephony calls for the Voice Pipeline timeline graph. Read-only
// Prisma query (dashboard-side only; never in the realtime audio loop). Returns
// just what the timeline + tooltip + selection need — the per-stage breakdown
// for a selected call is computed separately from that call's own events
// (/api/voice/events), so nothing here is fabricated.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params=new URL(request.url).searchParams;
  const limit = Math.max(1,Math.min(100, Number(params.get("limit")) || 40));
  const org=await getDefaultOrg();
  const rates=buildRateMap(await prisma.providerRate.findMany());

  const calls = await prisma.call.findMany({
    where: { organizationId:org.id, ...(params.get('channel')==='demo'?{fromNumber:'demo-user'}:{OR:[{livekitRoomName:{not:null}},{fromNumber:'demo-user'}]}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      assistant: { select: { name: true, voiceId: true, llmProvider: true, llmModel: true, ttsProvider: true, sttProvider: true } },
    },
  });

  return Response.json({
    calls: calls.map((c) => {
      const channel=callChannel(c);const breakdown=computeCallCost(c,rates,{includeUnavailable:true});
      const active=['QUEUED','RINGING','IN_PROGRESS'].includes(c.status);
      const usage=voiceUsage(c.metadata);
      return ({
      id: c.id,
      room: c.livekitRoomName,
      status: c.status,            // QUEUED | RINGING | IN_PROGRESS | COMPLETED | FAILED | NO_ANSWER | BUSY | CANCELED
      outcome: c.outcome ?? null,
      phone: channel==='Demo'?'Browser demo':c.direction === "INBOUND" ? (c.fromNumber || c.toNumber) : (c.toNumber || c.fromNumber),
      channel,
      costUsd:breakdown.totalUsd,
      modelCostUsd:breakdown.lines.filter(line=>line.category==='LLM').reduce((sum,line)=>sum+line.costUsd,0),
      usage:usage?{model:c.llmSkuUsed||usage.model||null,tokens:usage.tokens||{},complete:usage.complete===true}:null,
      breakdown,
      costStatus:active?'pending':breakdown.hasUnknownRates||(channel==='Demo'&&!usage?.complete)?'incomplete':'estimated',
      fromNumber: c.fromNumber,
      toNumber: c.toNumber,
      direction: c.direction,
      assistant: c.assistant?.name ?? null,
      voice: c.assistant?.voiceId ?? null,
      llm: c.assistant?.llmProvider ?? null,
      llmModel: c.assistant?.llmModel ?? null,
      stt: c.assistant?.sttProvider ?? null,
      tts: c.assistant?.ttsProvider ?? null,
      createdAt: (c.answeredAt ?? c.startedAt ?? c.createdAt)?.toISOString() ?? null,
      endedAt: c.endedAt?.toISOString() ?? null,
      durationSeconds: c.durationSeconds ?? (c.endedAt && c.startedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : null),
    });}),
  });
}
