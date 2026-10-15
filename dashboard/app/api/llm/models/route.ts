import { auth } from "@/lib/auth";
import { LLM_PROVIDER_MODELS, type ModelCatalog } from "@/lib/llm-models";

// Live model discovery for the assistant editor. Proxies to voice-service,
// which holds the provider credentials and queries each provider's own models
// endpoint — so the dropdown reflects what the account can actually use today
// rather than a list baked into the code.
//
// `?refresh=1` bypasses the catalog's cache (the "Refresh models" button).
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

/** Local list, used when voice-service itself is unreachable. */
function localFallback(provider: string, error: string): ModelCatalog {
  const list = LLM_PROVIDER_MODELS[provider.toUpperCase()] ?? [];
  return {
    provider,
    models: list.map((m, i) => ({
      id: m.value, label: m.label, provider, context: null,
      status: "unknown", recommended: i === 0,
    })),
    source: "fallback",
    stale: true,
    error,
    recommended: list[0]?.value ?? "",
    count: list.length,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const provider = (url.searchParams.get("provider") || "").trim();
  if (!provider) return Response.json({ error: "provider is required" }, { status: 400 });
  const refresh = ["1", "true", "yes"].includes(
    (url.searchParams.get("refresh") || "").toLowerCase());

  try {
    const r = await fetch(
      `${BASE}/api/llm/models?provider=${encodeURIComponent(provider)}&refresh=${refresh}`,
      { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}, cache: "no-store",
        signal: AbortSignal.timeout(20000) },
    );
    if (!r.ok) {
      return Response.json(
        localFallback(provider, `voice-service returned ${r.status}`), { status: 200 });
    }
    return Response.json(await r.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(localFallback(provider, `voice-service unreachable: ${msg}`));
  }
}
