import { prisma } from "@/lib/prisma";
import { voiceService } from "@/lib/voice-service";
import { PROVIDERS } from "@/lib/providerRegistry";
import ProvidersDashboard from "@/components/ProvidersDashboard";

export const dynamic = "force-dynamic";

// Providers operations dashboard. "Configured" per logical provider = any of its
// env keys is present (env in the running voice-service, OR a stored settings
// override). Runtime status/activity is derived live in the client component from
// the SAME unified event stream Live Logs uses — not from config presence.
async function configuredKeys(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const envMap = await voiceService.settings(); // { KEY: { configured } }
    for (const [k, v] of Object.entries(envMap)) {
      if (v && (v as { configured?: boolean }).configured) out.add(k);
    }
  } catch { /* voice-service offline → env unknown; stored values still count */ }
  try {
    const stored = await prisma.setting.findMany({ select: { key: true, value: true } });
    for (const s of stored) if (s.value) out.add(s.key);
  } catch { /* db unreachable */ }
  return out;
}

export default async function ProvidersPage() {
  const keys = await configuredKeys();
  const configured: Record<string, boolean> = {};
  for (const def of PROVIDERS) {
    configured[def.key] = def.intrinsic || def.envKeys.some((k) => keys.has(k));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Providers</h1>
        <p className="mt-1 text-sm text-gray-400">
          Runtime operations view — click any provider to see whether requests are reaching it,
          responses are returning, how long they take, and exactly where failures occur. Scoped to
          the current live session.
        </p>
      </div>
      <ProvidersDashboard configured={configured} />
    </div>
  );
}
