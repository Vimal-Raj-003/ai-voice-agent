// Minimal Cal.com (v1) client for the dashboard — currently only cancellation,
// used to keep an appointment's external booking in sync when an admin cancels
// it from the calendar page. Mirrors voice-service/tools.py's Cal.com v1 usage
// (apiKey query param). Reads CALCOM_API_KEY from the server env only.

const CALCOM_BASE = "https://api.cal.com/v1";

export function calcomConfigured(): boolean {
  return !!process.env.CALCOM_API_KEY;
}

export type CalcomResult = { ok: true } | { ok: false; error: string };

/** Cancel a Cal.com booking by uid. Never throws. */
export async function calcomCancel(uid: string, reason = ""): Promise<CalcomResult> {
  const apiKey = process.env.CALCOM_API_KEY || "";
  if (!apiKey) return { ok: false, error: "Cal.com not configured" };
  const params = new URLSearchParams({ apiKey });
  if (reason) params.set("reason", reason);
  try {
    const resp = await fetch(
      `${CALCOM_BASE}/bookings/${encodeURIComponent(uid)}/cancel?${params.toString()}`,
      { method: "DELETE", signal: AbortSignal.timeout(15_000) },
    );
    if (![200, 201, 204].includes(resp.status)) {
      return { ok: false, error: `Cal.com cancel failed: HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Cal.com cancel error" };
  }
}
