"use client";

// Ephemeral client-side event bus for Live Logs UI-action events (campaign
// selected, manual call clicked, …). These are intentionally NOT persisted to
// the database — Live Logs is an ephemeral current-session timeline, and the
// error_logs table stays reserved for real backend events. LiveLogs listens for
// the "jj-live-log" window event and merges these into its in-memory timeline.

export type LiveBusEvent = {
  category: string;   // UI | CAMPAIGN | CALL | SYSTEM …
  event: string;      // e.g. campaign_selected
  detail?: Record<string, unknown>;
  level?: "INFO" | "WARNING" | "ERROR";
};

export function emitLiveEvent(ev: LiveBusEvent): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("jj-live-log", {
        detail: {
          category: ev.category,
          event: ev.event,
          level: ev.level || "INFO",
          detail: ev.detail || {},
          ts: Date.now(),
        },
      }),
    );
  } catch {
    /* ignore — the bus is best-effort observability */
  }
}
