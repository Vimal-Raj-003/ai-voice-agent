import { redirect } from "next/navigation";

// Costs & Usage now lives at the bottom of the Overview page. This route is
// kept so existing bookmarks keep working — it forwards to the Overview and
// anchors straight to the Costs section.
//
// Nothing cost-related was deleted: lib/cost.ts, lib/currency.ts, the
// ProviderRate table and the /api/rates endpoints are all untouched, and
// CostsView / RatesPanel are the same components, now rendered by Overview.
export default async function CostsPage() {
  redirect("/#costs");
}
