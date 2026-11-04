import type { NextAuthConfig } from "next-auth";

// Middleware verifies JWTs without importing the server's database client.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [],
} satisfies NextAuthConfig;
