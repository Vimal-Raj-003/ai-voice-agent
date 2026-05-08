import { requestReset } from "./actions";
import { redirect } from "next/navigation";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; sent?: string }>;
}) {
  const sp = await searchParams;
  async function submit(formData: FormData) {
    "use server";
    const r = await requestReset(formData);
    if (r.sent) redirect("/forgot-password?sent=1");
    redirect(`/forgot-password?link=${encodeURIComponent(r.previewLink || "")}`);
  }
  return (
    <main className="grid min-h-screen place-items-center">
      <form action={submit} className="w-full max-w-sm glass rounded-2xl p-6 space-y-4">
        <h1 className="text-xl font-bold">Reset password</h1>
        <p className="text-xs text-gray-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>
        {sp.sent === "1" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] p-2 text-xs text-emerald-200">
            If an account exists for that email, a reset link has been sent.
          </div>
        )}
        {sp.link && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-2 text-xs text-amber-200 break-all">
            SMTP not configured — copy this reset link manually:
            <div className="mt-1 font-mono text-[10px] text-amber-100">{sp.link}</div>
          </div>
        )}
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        />
        <button type="submit" className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">
          Send reset link
        </button>
      </form>
    </main>
  );
}
