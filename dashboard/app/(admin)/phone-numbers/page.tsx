import { redirect } from "next/navigation";

// Phone numbers now live as a section of the Contacts page. This route is kept
// so existing bookmarks still work, and so the redirect("/phone-numbers") and
// revalidatePath("/phone-numbers") calls in ./actions.ts keep landing somewhere
// valid — it forwards to Contacts with the Phone Numbers section already open.
//
// The sub-routes /phone-numbers/new and /phone-numbers/[id] are unchanged and
// still own add/edit, validation and assistant assignment.
export default async function PhoneNumbersPage() {
  redirect("/contacts?section=numbers");
}
