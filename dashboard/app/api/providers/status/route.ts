import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { voiceService } from "@/lib/voice-service";
import { PROVIDERS } from "@/lib/providerRegistry";
import { deriveCardStatus } from "@/lib/providerStatus";
import { parseMeta, deriveStatus, categorize, fingerprint, type LiveEvent } from "@/lib/eventModel";

// REAL status for every provider card, derived from persisted runtime events
// (error_logs) — health/diagnostic probes AND genuine call traffic. A provider is
// never reported CONNECTED merely because a key exists.
export const dynamic = "force-dynamic";

async function configuredKeys(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const envMap = await voiceService.settings();
    for (const [k, v] of Object.entries(envMap)) {
      if (v && (v as { configured?: boolean }).configured) out.add(k);
    }
  } catch { /* voice service offline → fall back to stored settings only */ }
  try {
    const stored = await prisma.setting.findMany({ select: { key: true, value: true } });
    for (const s of stored) if (s.value) out.add(s.key);
  } catch { /* db unreachable */ }
  return out;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const t0 = Date.now();
  const [keys, rows] = await Promise.all([
    configuredKeys(),
    prisma.errorLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 1500,
      select: { id: true, source: true, level: true, message: true, detail: true, timestamp: true },
    }),
  ]);
  const dbLatency = Date.now() - t0;

  const events: LiveEvent[] = rows.map((r) => {
    const ts = r.timestamp.getTime();
    const meta = parseMeta(r.detail ?? undefined);
    const source = r.source ?? "";
    const level = r.level ?? "INFO";
    const message = r.message ?? "";
    return {
      id: fingerprint(r.timestamp.toISOString(), message, meta, source),
      source, level, status: deriveStatus(level, message), message,
      detail: r.detail ?? undefined, timestamp: r.timestamp.toISOString(), ts,
      category: categorize(source, message, level), meta,
    };
  });

  // The query above IS a live database health check: it either succeeded (we are
  // here) or threw. Record it as a real event so the Database card reports the
  // request we actually made instead of "no successful check yet".
  const dbNow = Date.now();
  events.unshift({
    id: `db-live-${dbNow}`, source: "DATABASE", level: "INFO", status: "SUCCESS",
    message: "database_query_completed", timestamp: new Date(dbNow).toISOString(), ts: dbNow,
    category: "DATABASE",
    meta: { provider: "database", latency_ms: String(dbLatency), rows: String(rows.length) },
  });

  const providers = PROVIDERS.map((def) => {
    const configured = def.intrinsic || def.envKeys.some((k) => keys.has(k));
    return { key: def.key, label: def.label, kind: def.kind, configured,
             ...deriveCardStatus(def, events, configured) };
  });

  return Response.json({ providers, scannedEvents: events.length, at: new Date().toISOString() });
}
