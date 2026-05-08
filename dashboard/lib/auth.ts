// NextAuth v5 (App Router) — single-admin credentials provider.
// ADMIN_EMAIL + ADMIN_PASSWORD_HASH are read from env at runtime; rotate by
// regenerating the bcrypt hash and updating .env, no DB changes needed.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Required when running behind a reverse proxy (Caddy, Vercel, etc.) — without
  // it NextAuth refuses to issue the session cookie because it can't verify
  // the host header.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim();
        const password = String(credentials?.password ?? "");
        const adminEmail = process.env.ADMIN_EMAIL ?? "";
        const adminHash = process.env.ADMIN_PASSWORD_HASH ?? "";
        if (!adminEmail || !adminHash) {
          console.error(
            "[auth] ADMIN_EMAIL or ADMIN_PASSWORD_HASH is not set",
          );
          return null;
        }
        // bcrypt hashes are exactly 60 chars and start with $2a/$2b/$2y. If
        // the env loader expanded the $-prefixed segments (a known
        // @next/env pitfall), the hash will be shorter and unparseable —
        // surface that loudly so it doesn't look like a wrong-password.
        if (adminHash.length !== 60 || !/^\$2[abxy]\$/.test(adminHash)) {
          console.error(
            "[auth] ADMIN_PASSWORD_HASH looks malformed (length=%d). " +
              "Escape each $ in the env file as \\$ — e.g. " +
              "ADMIN_PASSWORD_HASH=\\$2b\\$10\\$… — otherwise Next.js's " +
              "env loader strips the $-prefixed segments.",
            adminHash.length,
          );
          return null;
        }
        if (email.toLowerCase() !== adminEmail.toLowerCase()) return null;
        const ok = await bcrypt.compare(password, adminHash);
        return ok
          ? { id: "admin", email: adminEmail, name: "Admin" }
          : null;
      },
    }),
  ],
});

// Role-based authorization helpers live in `./require-role.ts` so this file
// (imported by middleware running on the edge runtime) stays free of the
// Prisma client. See lib/require-role.ts.
