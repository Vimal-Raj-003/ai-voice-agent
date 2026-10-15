import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

// The provider registry lives in voice-service/provider_registry.py — the same
// file the worker builds adapters from. Serving it here is what stops the UI
// keeping its own copy of the provider list.
//
// This route also tells the registry which providers THIS organisation has
// stored their own key for, so `status` and `canRunCalls` come back already
// resolved for them. Only provider NAMES are sent; the ciphertext never leaves
// the database and no credential is ever returned to the browser.
export const dynamic = "force-dynamic";

const BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const capability = new URL(req.url).searchParams.get("capability") || "";

  // Which providers this tenant has supplied a key for.
  let byok = "";
  try {
    const { id: orgId } = await getDefaultOrg();
    const rows = await prisma.providerCredential.findMany({
      where: { organizationId: orgId },
      select: { provider: true },
    });
    byok = rows.map((r) => r.provider).join(",");
  } catch {
    // No credentials table yet, or the org lookup failed: fall through with an
    // empty list so every provider still renders, just without tenant keys.
  }

  const qs = new URLSearchParams();
  if (capability) qs.set("capability", capability);
  if (byok) qs.set("byok", byok);

  try {
    const r = await fetch(
      `${BASE}/api/providers/registry${qs.toString() ? `?${qs}` : ""}`,
      { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}, cache: "no-store",
        signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) return Response.json({ providers: [], error: `voice-service ${r.status}` });
    return Response.json(await r.json());
  } catch (e) {
    // The form must still render if the worker is down; it falls back to the
    // local snapshot and says the list may be stale.
    return Response.json({ providers: [], error: `voice service unreachable: ${e}` });
  }
}
