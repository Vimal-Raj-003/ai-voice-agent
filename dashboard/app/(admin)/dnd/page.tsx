import { redirect } from "next/navigation";

// Do-Not-Call now lives as a section of the Contacts page. This route is kept
// so existing bookmarks and the revalidatePath("/dnd") calls in ./actions.ts
// still resolve — it forwards to Contacts with the DNC section already open.
//
// The sub-routes under /dnd (e.g. /dnd/new) and ./actions.ts are unchanged:
// nothing about DNC validation, normalisation or outbound blocking moved.
export default async function DndPage() {
  redirect("/contacts?section=dnc");
}
