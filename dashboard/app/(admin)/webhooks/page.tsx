import { redirect } from "next/navigation";

// Webhooks now live as a tab of Settings. The listing itself moved to
// components/WebhooksSection.tsx; this route is kept so existing links and
// bookmarks still resolve.
//
// Scope: this is the ADMIN UI route only. It does not affect
// app/api/webhooks/* — the incoming delivery endpoints external services POST
// to — nor the outgoing delivery, retry or signature logic, none of which are
// touched. /webhooks/new and /webhooks/{id} keep working as their own pages.
export default function WebhooksPage() {
  redirect("/settings?tab=webhooks");
}
