import { signIn } from "@/lib/auth";
import { Sparkles, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        action={async (formData) => {
          "use server";
          await signIn("credentials", {
            email: formData.get("email"),
            password: formData.get("password"),
            redirectTo: sp.callbackUrl || "/",
          });
        }}
        className="glass rounded-3xl p-8 w-full max-w-sm space-y-4"
      >
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-gradient-to-br from-cyan-400 via-violet-400 to-pink-400 flex items-center justify-center glow-violet">
            <Sparkles size={16} className="text-black" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-violet-300/80">
              Rapid X AI
            </div>
            <div className="text-lg font-bold text-gradient">OutboundAI</div>
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-xs text-gray-500 mt-1">
            Single-admin login — credentials configured via environment.
          </p>
        </div>
        {sp.error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>Sign-in failed. Check email and password and try again.</span>
          </div>
        )}
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Email
          </span>
          <input
            name="email"
            type="email"
            required
            placeholder="admin@example.com"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Password
          </span>
          <input
            name="password"
            type="password"
            required
            placeholder="••••••••"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </label>
        <button className="w-full rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.3)] transition">
          Sign in
        </button>
      </form>
    </div>
  );
}
