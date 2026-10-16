// Cal.com access for the dashboard.
//
// The dashboard holds NO Cal.com credentials. It used to call
// https://api.cal.com/v1 directly with its own CALCOM_API_KEY — that API is
// now decommissioned (every v1 request returns HTTP 410), and keeping a second
// copy of the key here would mean two places to rotate and two code paths to
// keep in step.
//
// Instead both callers go through the voice service, which owns the key and
// already speaks Cal.com API v2 (tools.calcom_cancel). That gives one
// credential location, one cancellation behaviour, one set of booking
// identifiers and one authentication scheme across the dashboard and the
// agent. Nothing here ever reaches the browser: these run in server actions
// and server components, and the only secret involved is the existing
// VOICE_SERVICE_TOKEN used for service-to-service auth.

import { voiceService } from "@/lib/voice-service";

export type CalcomResult = { ok: true } | { ok: false; error: string };

export type CalcomStatus = {
  configured: boolean;
  eventTypeId: string | null;
  timezone: string;
};

/**
 * Whether Cal.com is usable, as reported by the service that owns the key.
 *
 * Async because the answer lives in the voice service's environment, not the
 * dashboard's. Returns `configured: false` when the service is unreachable —
 * the caller must not claim a working integration it could not verify.
 */
export async function calcomStatus(): Promise<CalcomStatus> {
  try {
    const s = await voiceService.calcomStatus();
    return {
      configured: !!s.configured,
      eventTypeId: s.event_type_id ?? null,
      timezone: s.timezone || "Asia/Kolkata",
    };
  } catch {
    return { configured: false, eventTypeId: null, timezone: "Asia/Kolkata" };
  }
}

/** Cancel a Cal.com booking by uid. Never throws. */
export async function calcomCancel(uid: string, reason = ""): Promise<CalcomResult> {
  try {
    const r = await voiceService.calcomCancelBooking(uid, reason);
    return r?.success ? { ok: true } : { ok: false, error: r?.message || "Cal.com cancel failed" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Cal.com cancel error" };
  }
}
