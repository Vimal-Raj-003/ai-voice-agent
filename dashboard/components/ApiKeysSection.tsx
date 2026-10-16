import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { Plus, Key } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/Badge";
import {
  revokeApiKey, deleteApiKey,
  listProviderCredentials, saveProviderCredential,
  recheckProviderCredential, deleteProviderCredential,
} from "@/app/(admin)/api-keys/actions";
import ProviderCredentials from "@/components/ProviderCredentials";

// The former /api-keys page body, moved verbatim so it can render as a tab of
// Settings. Same org-scoped queries, same server actions (revoke / delete /
// save / recheck provider credential), same ProviderCredentials component — so
// REST key management, BYOK storage, encryption and the platform-key fallback
// all behave exactly as before.
//
// It stays a SERVER component: the lists are read with prisma and every mutation
// is a server action. Re-housing it in a client tab would have meant
// re-implementing both.
//
// The sub-route /api-keys/new is unchanged and still issues keys.
export default async function ApiKeysSection() {
  const { id: orgId } = await getDefaultOrg();
  const rows = await prisma.apiKey.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  });
  const credentialRows = await listProviderCredentials();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">REST API keys</h2>
          <p className="text-sm text-gray-400 mt-1">
            Bearer tokens for the voice-service REST API. Each key is shown in
            plaintext only at creation time — store it somewhere safe.
          </p>
        </div>
        <Link
          href="/api-keys/new"
          className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-3 py-1.5 text-sm font-medium hover:opacity-90"
        >
          <Plus size={14} /> New key
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No keys yet"
          description="Create an API key to authenticate against the voice-service from external systems (CRMs, n8n, your own backend)."
          action={{ href: "/api-keys/new", label: "Issue your first key" }}
        />
      ) : (
        <div className="glass rounded-2xl divide-y divide-white/5">
          {rows.map((k) => {
            const revoked = k.revokedAt != null;
            return (
              <div
                key={k.id}
                className="flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{k.name}</span>
                    <Badge tone={revoked ? "muted" : "success"}>
                      {revoked ? "revoked" : "active"}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono mt-1">
                    {k.prefix}…
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    Created {k.createdAt.toLocaleString()}
                    {k.lastUsedAt
                      ? ` · last used ${k.lastUsedAt.toLocaleString()}`
                      : " · never used"}
                    {revoked && k.revokedAt
                      ? ` · revoked ${k.revokedAt.toLocaleString()}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!revoked && (
                    <form action={revokeApiKey.bind(null, k.id)}>
                      <button className="text-xs text-amber-300 hover:text-amber-200 px-2 py-1">
                        Revoke
                      </button>
                    </form>
                  )}
                  <form action={deleteApiKey.bind(null, k.id)}>
                    <button className="text-xs text-red-400 hover:text-red-300 px-2 py-1">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProviderCredentials
        rows={credentialRows}
        save={saveProviderCredential}
        recheck={recheckProviderCredential}
        remove={deleteProviderCredential}
      />
    </div>
  );
}
