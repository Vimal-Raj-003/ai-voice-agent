import { redirect } from "next/navigation";

// API keys now live as a tab of Settings. This route is kept so existing
// bookmarks still work, and it forwards to that tab.
//
// Nothing was deleted: ./actions.ts, the apiKey + providerCredential tables,
// the encryption helpers and the /api-keys/new issuing page are all unchanged,
// so existing keys, BYOK credentials and the platform-key fallback keep working.
export default async function ApiKeysPage() {
  redirect("/settings?tab=api-keys");
}
