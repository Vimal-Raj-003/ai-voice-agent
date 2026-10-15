"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { emitLiveEvent } from "@/lib/liveBus";

// Centralized client-side instrumentation for the unified Live Logs console.
// Mounted ONCE in the admin layout. It feeds three classes of frontend events
// into the SAME `jj-live-log` bus that LiveLogs listens to:
//   1. meaningful navigation (which page the operator opened)
//   2. uncaught frontend errors + unhandled promise rejections (category UI)
//   3. failed API calls — non-2xx responses and network throws (category API)
// All work happens in effects (client-only) so it never runs during SSR.
//
// These are EPHEMERAL observability events — none are written to the database.
// The log endpoints themselves are skipped to avoid a feedback loop.

// Map a route to a meaningful "page opened" event. Only routes worth seeing in
// the flow — not every click.
function navEvent(path: string): { event: string; detail: Record<string, unknown> } | null {
  if (path === "/" || path === "/dashboard") return { event: "dashboard_opened", detail: { route: path } };
  if (path === "/live-logs") return { event: "live_logs_opened", detail: { route: path } };
  if (path === "/calls") return { event: "call_page_opened", detail: { route: path } };
  if (path === "/campaigns") return { event: "campaign_page_opened", detail: { route: path } };
  if (/^\/campaigns\/[^/]+$/.test(path)) return { event: "campaign_opened", detail: { route: path, campaign_id: path.split("/")[2] } };
  if (path === "/assistants") return { event: "assistants_page_opened", detail: { route: path } };
  if (path === "/calendar") return { event: "calendar_opened", detail: { route: path } };
  if (path === "/contacts") return { event: "contacts_page_opened", detail: { route: path } };
  // Generic fallthrough for other admin pages — still useful for flow context.
  return { event: "page_opened", detail: { route: path } };
}

// Endpoints we must NOT instrument (would loop: logging a log request).
function isLogEndpoint(url: string): boolean {
  return url.includes("/api/logs/") || url.includes("/api/voice/diag");
}

export default function LiveLogsInstrumentation() {
  const pathname = usePathname();
  const lastPathRef = useRef<string>("");

  // 1. Navigation events.
  useEffect(() => {
    if (!pathname || pathname === lastPathRef.current) return;
    lastPathRef.current = pathname;
    const n = navEvent(pathname);
    if (n) emitLiveEvent({ category: "UI", event: n.event, detail: n.detail });
  }, [pathname]);

  // 2. Global error + unhandled rejection capture.  3. fetch failures.
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      emitLiveEvent({
        category: "UI", level: "ERROR", event: "frontend_exception",
        detail: {
          message: e.message, route: window.location.pathname,
          source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
          stack: e.error?.stack ? String(e.error.stack).slice(0, 2000) : undefined,
          impact: "A frontend component or script threw",
        },
      });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      emitLiveEvent({
        category: "UI", level: "ERROR", event: "unhandled_promise_rejection",
        detail: {
          message: r instanceof Error ? r.message : String(r), route: window.location.pathname,
          stack: r instanceof Error && r.stack ? String(r.stack).slice(0, 2000) : undefined,
          impact: "An async operation rejected with no handler",
        },
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // fetch instrumentation — patch once, guarded against double-install.
    const w = window as unknown as { __jjFetchPatched?: boolean };
    let restore: (() => void) | null = null;
    if (!w.__jjFetchPatched && typeof window.fetch === "function") {
      w.__jjFetchPatched = true;
      const orig = window.fetch.bind(window);
      const patched: typeof window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
        if (isLogEndpoint(url)) return orig(input, init);
        const t0 = performance.now();
        try {
          const res = await orig(input, init);
          const latency_ms = Math.round(performance.now() - t0);
          if (!res.ok) {
            emitLiveEvent({
              category: "API", level: res.status >= 500 ? "ERROR" : "WARNING", event: "api_request_failed",
              detail: {
                message: `${method} ${shortPath(url)} → ${res.status}`,
                endpoint: shortPath(url), method, http_status: res.status, latency_ms,
                retryable: res.status >= 500 || res.status === 429,
                route: window.location.pathname, impact: "API call returned an error status",
              },
            });
          }
          return res;
        } catch (err) {
          const latency_ms = Math.round(performance.now() - t0);
          emitLiveEvent({
            category: "API", level: "ERROR", event: "api_request_error",
            detail: {
              message: `${method} ${shortPath(url)} — ${err instanceof Error ? err.message : String(err)}`,
              endpoint: shortPath(url), method, latency_ms, retryable: true,
              route: window.location.pathname, impact: "Network request threw (server unreachable / aborted)",
            },
          });
          throw err;
        }
      };
      window.fetch = patched;
      restore = () => { if (window.fetch === patched) { window.fetch = orig; w.__jjFetchPatched = false; } };
    }

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      restore?.();
    };
  }, []);

  return null;
}

// Collapse absolute URLs to a path so logs stay readable and never leak hosts.
function shortPath(url: string): string {
  try { return new URL(url, window.location.origin).pathname; } catch { return url.slice(0, 120); }
}
