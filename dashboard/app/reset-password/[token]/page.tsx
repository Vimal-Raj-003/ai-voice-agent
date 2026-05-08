import { redirect } from "next/navigation";
import { applyReset } from "./actions";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  async function submit(formData: FormData) {
    "use server";
    await applyReset(token, formData);
    redirect("/login?reset=1");
  }
  return (
    <main className="grid min-h-screen place-items-center">
      <form action={submit} className="w-full max-w-sm glass rounded-2xl p-6 space-y-4">
        <h1 className="text-xl font-bold">Set a new password</h1>
        <input
          name="password"
          type="password"
          minLength={8}
          required
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <button type="submit" className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">
          Update password
        </button>
      </form>
    </main>
  );
}
