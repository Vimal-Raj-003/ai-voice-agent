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
        if (!adminEmail || !adminHash) return null;
        if (email.toLowerCase() !== adminEmail.toLowerCase()) return null;
        const ok = await bcrypt.compare(password, adminHash);
        return ok
          ? { id: "admin", email: adminEmail, name: "Admin" }
          : null;
      },
    }),
  ],
});
