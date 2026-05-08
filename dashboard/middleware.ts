import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Wrap the request with NextAuth's auth() — req.auth is now populated.
// We:
//   - allow unauthenticated access only to /login (and the next-auth API)
//   - bounce authenticated users away from /login back to the dashboard
// The matcher below excludes the SSE / demo proxy routes from middleware so
// the browser-side EventSource / LiveKit-client integrations keep working —
// the bearer token sent to voice-service is what protects those.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLogin = pathname.startsWith("/login");
  const isPublic =
    isLogin ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password");
  const isAuthenticated = !!req.auth;
  if (!isAuthenticated && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthenticated && isLogin) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|api/logs/proxy|api/demo/proxy|_next/static|_next/image|favicon.ico).*)",
  ],
};
