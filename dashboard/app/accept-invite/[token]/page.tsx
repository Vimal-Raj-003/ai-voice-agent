import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  const valid =
    invite && !invite.acceptedAt && invite.expiresAt > new Date();

  async function accept(formData: FormData) {
    "use server";
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const invite = await prisma.invite.findUnique({ where: { tokenHash } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      throw new Error("Invite expired or already used");
    }
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "").trim() || null;
    if (password.length < 8) throw new Error("Password must be >= 8 chars");
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.create({
        data: {
          email: invite.email,
          name,
          passwordHash,
          organizationId: invite.organizationId,
          role: invite.role,
          invitedBy: invite.invitedBy,
        },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
    redirect("/login?invited=1");
  }

  if (!valid) {
    return (
      <main className="grid min-h-screen place-items-center text-gray-300">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Invite invalid</h1>
          <p className="text-sm text-gray-500">
            This invite has expired or already been used.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center">
      <form
        action={accept}
        className="w-full max-w-sm glass rounded-2xl p-6 space-y-4"
      >
        <div>
          <h1 className="text-xl font-bold">Accept invite</h1>
          <p className="text-xs text-gray-500 mt-1">
            {invite!.email} &mdash; role {invite!.role}
          </p>
        </div>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Name (optional)
          </span>
          <input
            name="name"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Set password
          </span>
          <input
            name="password"
            type="password"
            minLength={8}
            required
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium hover:bg-violet-400"
        >
          Create account
        </button>
      </form>
    </main>
  );
}
