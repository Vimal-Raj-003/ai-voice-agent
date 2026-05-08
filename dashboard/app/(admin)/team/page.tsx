import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { Badge } from "@/components/Badge";
import {
  changeRole,
  deactivateUser,
  reactivateUser,
  revokeInvite,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireRole("ADMIN");
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Team</h1>
        <Link
          href="/team/new"
          className="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium hover:bg-violet-400"
        >
          Invite member
        </Link>
      </div>

      <section className="glass rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Members
        </h2>
        <ul className="divide-y divide-white/5">
          {users.map((u) => (
            <li
              key={u.id}
              className="py-3 flex items-center justify-between gap-3"
            >
              <div>
                <div className="text-sm font-medium">
                  {u.name || u.email}
                  {!u.isActive && (
                    <span className="ml-2 text-[10px] text-gray-500 uppercase">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">{u.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="violet">{u.role}</Badge>
                <form
                  action={u.isActive ? deactivateUser.bind(null, u.id) : reactivateUser.bind(null, u.id)}
                >
                  <button className="text-xs text-gray-400 hover:text-white">
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="glass rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Pending invites
          </h2>
          <ul className="divide-y divide-white/5">
            {invites.map((i) => (
              <li
                key={i.id}
                className="py-3 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm">{i.email}</div>
                  <div className="text-xs text-gray-500">
                    expires {i.expiresAt.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="violet">{i.role}</Badge>
                  <form action={revokeInvite.bind(null, i.id)}>
                    <button className="text-xs text-red-400 hover:text-red-300">
                      Revoke
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
