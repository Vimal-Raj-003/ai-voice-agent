import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth-config";
import { prisma } from "./prisma";
import { verifyAdminPassword } from "./admin-password";
import { syncLoginAuditEvent } from "./crm-zulip-sync";

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
        if (!email) return null;
        const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
        const isEnvAdmin = Boolean(adminEmail && email === adminEmail);

        const user = await prisma.user.findUnique({ where: { email } });
        if (user && !user.isActive) {
          void syncLoginAuditEvent({
            email,
            userName: user.name ?? undefined,
            role: isEnvAdmin || user.role === "ADMIN" ? "ADMIN" : "USER",
            success: false,
            reason: "Account deactivated",
          });
          return null;
        }

        if (!isEnvAdmin && !user) {
          void syncLoginAuditEvent({
            email,
            role: "USER",
            success: false,
            reason: "Unknown email",
          });
          return null;
        }

        const ok = await verifyAdminPassword(
          String(credentials?.password ?? ""),
          user?.passwordHash,
          isEnvAdmin ? process.env.ADMIN_PASSWORD_HASH : undefined,
        );

        const roleLabel: "ADMIN" | "USER" =
          isEnvAdmin || user?.role === "ADMIN" ? "ADMIN" : "USER";

        if (!ok) {
          void syncLoginAuditEvent({
            email,
            userName: user?.name ?? undefined,
            role: roleLabel,
            success: false,
            reason: "Invalid password",
          });
          return null;
        }

        if (user?.id) {
          void prisma.user
            .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
            .catch(() => {});
        }

        void syncLoginAuditEvent({
          email,
          userName: user?.name ?? (isEnvAdmin ? "Admin" : "User"),
          role: roleLabel,
          success: true,
        });

        return { id: user?.id ?? "admin", email, name: user?.name ?? "Admin" };
      },
    }),
  ],
});
