// Role-based authorization helper. Lives in its own module so it can import
// `prisma` without dragging the Prisma client into the middleware bundle —
// Next.js's middleware runs on the edge runtime which doesn't expose Node's
// `global`. Keeping `lib/auth.ts` prisma-free keeps the edge bundle small
// and prevents `global is not defined` runtime crashes.

import { auth } from "./auth";
import { prisma } from "./prisma";

export type Role = "OWNER" | "ADMIN" | "AGENT" | "VIEWER";

const RANK: Record<Role, number> = {
  VIEWER: 0,
  AGENT: 1,
  ADMIN: 2,
  OWNER: 3,
};

export class AuthorizationError extends Error {
  code: "UNAUTHENTICATED" | "INACTIVE" | "FORBIDDEN";
  constructor(code: "UNAUTHENTICATED" | "INACTIVE" | "FORBIDDEN") {
    super(code);
    this.code = code;
  }
}

/**
 * Gate a server action behind a minimum role. Throws on auth failure so the
 * action's caller (Next.js form action runtime) renders the error boundary.
 * Reads ARE intentionally not gated here — page-level prisma queries already
 * scope by org, and gating reads breaks the existing read-everything UX.
 */
export async function requireRole(min: Role) {
  const session = await auth();
  if (!session?.user?.email) throw new AuthorizationError("UNAUTHENTICATED");
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) throw new AuthorizationError("UNAUTHENTICATED");
  if (!user.isActive) throw new AuthorizationError("INACTIVE");
  if (RANK[user.role as Role] < RANK[min]) {
    throw new AuthorizationError("FORBIDDEN");
  }
  return { user };
}
