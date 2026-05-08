import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import InviteForm from "@/components/InviteForm";
import { inviteUser } from "../actions";

export default async function NewInvitePage() {
  await requireRole("ADMIN");
  async function action(formData: FormData) {
    "use server";
    const result = await inviteUser(formData);
    if (result.sent) redirect("/team");
    redirect(`/team?invite_link=${encodeURIComponent(result.previewLink || "")}`);
  }
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Invite member</h1>
      <InviteForm action={action} />
    </div>
  );
}
