import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth-config";
import { prisma } from "./prisma";
import { verifyAdminPassword } from "./admin-password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
        if (!adminEmail || email !== adminEmail) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (user && !user.isActive) return null;
        const ok = await verifyAdminPassword(
          String(credentials?.password ?? ""),
          user?.passwordHash,
          process.env.ADMIN_PASSWORD_HASH,
        );
        return ok ? { id: user?.id ?? "admin", email, name: user?.name ?? "Admin" } : null;
      },
    }),
  ],
});
