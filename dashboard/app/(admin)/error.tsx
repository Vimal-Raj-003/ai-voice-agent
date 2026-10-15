"use client";
import { useEffect } from "react";
import { emitLiveEvent } from "@/lib/liveBus";

// Route-level React error boundary for all admin pages. A render/runtime crash
// in any admin component lands here — we stream it into the unified Live Logs
// console (category UI / level ERROR) with the route + stack, then show a small
// recoverable fallback instead of a blank screen.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    emitLiveEvent({
      category: "UI", level: "ERROR", event: "react_component_crashed",
      detail: {
        message: error.message || "A page component crashed",
        route: typeof window !== "undefined" ? window.location.pathname : undefined,
        digest: error.digest,
        stack: error.stack ? String(error.stack).slice(0, 2000) : undefined,
        impact: "The page stopped rendering and showed the error fallback",
      },
    });
  }, [error]);

  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
      <h2 className="text-lg font-semibold text-red-300">Something went wrong on this page</h2>
      <p className="mt-2 text-sm text-gray-400">
        The error was streamed to{" "}
        <a href="/live-logs" className="text-purple-300 underline">Live logs</a>. You can retry.
      </p>
      {error.message && (
        <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-red-300/90">{error.message}</pre>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10"
      >
        Try again
      </button>
    </div>
  );
}
