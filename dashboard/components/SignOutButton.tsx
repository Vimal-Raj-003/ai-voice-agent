import { signOut } from "@/lib/auth";

export default function SignOutButton({
  email,
}: {
  email?: string | null;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
      className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02]"
    >
      <div className="text-[11px] text-gray-400 truncate">{email ?? "Admin"}</div>
      <button
        type="submit"
        className="mt-0.5 text-[11px] text-violet-300 hover:text-violet-200"
      >
        Sign out
      </button>
    </form>
  );
}
