import { redirect } from "next/navigation";

// The Tools dashboard page was removed from navigation. The route is kept as a
// redirect so an old bookmark lands somewhere valid instead of a 404.
//
// Nothing underneath was deleted: ./actions.ts, the tools table, the HTTP tool
// execution service and the assistant-to-tool binding UI on the assistant page
// are all untouched, so AI function-calling continues to work exactly as before.
export default async function RemovedToolsPage() {
  redirect("/");
}
