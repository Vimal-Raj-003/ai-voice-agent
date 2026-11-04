import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export default async function PasswordSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/settings/password");
  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/settings" className="text-sm text-violet-300 hover:underline">← Settings</Link>
      <h1 className="text-3xl font-bold">Password settings</h1>
      <ChangePasswordForm />
    </div>
  );
}
