import { redirect } from "next/navigation";

// Call history now lives as a section of the Contacts page. This route is kept
// so existing bookmarks keep working, and it forwards to Contacts with the
// Calls section open.
//
// Incoming query params are carried across, so a bookmarked FILTERED listing
// (e.g. /calls?direction=INBOUND&status=COMPLETED&page=2) lands on the same
// filtered view instead of being reset.
//
// The sub-routes /calls/[id] and /calls/[id]/logs are untouched: call detail,
// transcript, recording playback and the View Logs deep links all still resolve
// at their original URLs.
export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v && k !== "section") params.set(k, String(v));
  }
  params.set("section", "calls");
  redirect(`/contacts?${params.toString()}`);
}
