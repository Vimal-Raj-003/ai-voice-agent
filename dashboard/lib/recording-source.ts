// Which recording does a call play, and is it ready yet?
//
// Priority, per the integration spec:
//   1. VOBIZ  — the carrier's own copy (preferred: real PSTN audio, stereo)
//   2. LOCAL  — the locally mixed WAV from recorder.py (fallback)
//   3. neither — processing, or genuinely unavailable
//
// Backward compatibility is the whole point of keeping this in one pure
// function: every historical call has only `recordingObjectKey`, and those must
// keep playing exactly as before. A Vobiz recording is preferred only once it
// is actually READY — a Vobiz call still processing falls back to the local
// copy if one exists, so the user is never shown "processing" while a playable
// recording sits on disk.
import { isLocalRecordingKey } from "@/lib/recordings";

export type RecordingSource = "VOBIZ" | "LOCAL";
export type RecordingState =
  | { source: RecordingSource; status: "READY"; label: string }
  | { source: null; status: "PROCESSING" | "FAILED" | "UNAVAILABLE"; label: string };

/** The call fields the resolver needs. */
export type ResolvableCall = {
  recordingStatus: string | null;
  recordingObjectKey: string | null;
  providerRecordingStatus: string | null;
  providerRecordingUrl: string | null;
  providerRecordingId: string | null;
  // Only the post-call resolver needs this one, so it stays optional: the
  // playback routes should not have to select a column they never read.
  providerCallId?: string | null;
  recordingSource: string | null;
  telephonyProvider: string | null;
  sipCallId: string | null;
  endedAt: Date | null;
};

/** True when the local recorder produced a file we can still serve. */
export function hasLocalRecording(c: Pick<ResolvableCall, "recordingObjectKey">): boolean {
  return !!c.recordingObjectKey;
}

/** True when Vobiz's copy is fetchable right now. */
export function hasVobizRecording(
  c: Pick<ResolvableCall, "providerRecordingStatus" | "providerRecordingUrl">,
): boolean {
  return c.providerRecordingStatus === "READY" && !!c.providerRecordingUrl;
}

/**
 * How long after a call ends we keep saying "processing" before calling it
 * failed. Vobiz writes the recording after the leg clears, so a short wait is
 * normal; past this it is not coming.
 */
export const PROCESSING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Decide what the Calls page should show and which backend serves the bytes.
 *
 * Pure and side-effect free so it can be unit-tested and used identically on
 * the server and in the UI.
 */
export function resolveRecording(c: ResolvableCall, now: Date = new Date()): RecordingState {
  // 1. Vobiz wins when ready.
  if (hasVobizRecording(c)) {
    return { source: "VOBIZ", status: "READY", label: "Vobiz" };
  }

  // 2. Local fallback — including while Vobiz is still processing, and after a
  //    Vobiz failure. A playable file always beats a status message.
  if (hasLocalRecording(c)) {
    const label = isVobizCall(c) ? "Local fallback" : "Local";
    return { source: "LOCAL", status: "READY", label };
  }

  // 3. Nothing playable yet. Distinguish "still coming" from "never".
  if (c.providerRecordingStatus === "FAILED") {
    return { source: null, status: "FAILED", label: "Failed" };
  }
  if (isVobizCall(c) && withinProcessingWindow(c, now)) {
    return { source: null, status: "PROCESSING", label: "Recording processing…" };
  }
  if (c.providerRecordingStatus === "PROCESSING") {
    return { source: null, status: "PROCESSING", label: "Recording processing…" };
  }
  if (c.recordingStatus === "FAILED") {
    return { source: null, status: "FAILED", label: "Failed" };
  }
  return { source: null, status: "UNAVAILABLE", label: "No recording" };
}

function isVobizCall(c: Pick<ResolvableCall, "telephonyProvider">): boolean {
  return (c.telephonyProvider || "").toLowerCase() === "vobiz";
}

/** Still inside the post-call window where a Vobiz recording may appear. */
export function withinProcessingWindow(
  c: Pick<ResolvableCall, "endedAt">,
  now: Date = new Date(),
): boolean {
  if (!c.endedAt) return false;
  return now.getTime() - c.endedAt.getTime() < PROCESSING_WINDOW_MS;
}

/**
 * Should we attempt a Vobiz lookup for this call right now?
 *
 * This is the bounded fallback for when the recording webhook never arrives:
 * attempts are gated by the processing window rather than a retry counter, so
 * there is no unbounded polling and no extra column to track. Returns false
 * once READY, once FAILED, and once the window closes (the "timeout" case).
 */
export function shouldAttemptVobizLookup(c: ResolvableCall, now: Date = new Date()): boolean {
  if (!isVobizCall(c)) return false;
  if (hasVobizRecording(c)) return false;              // already resolved
  if (c.providerRecordingStatus === "FAILED") return false;
  if (!c.sipCallId) return false;                      // no deterministic key → never guess
  if (!c.endedAt) return false;                        // still live: not post-call yet
  return withinProcessingWindow(c, now);
}

/** Readable download filename, e.g. JillJill_Call_<id>_2026-10-14.wav */
export function downloadFilename(
  callId: string,
  endedAt: Date | null,
  format: string | null | undefined,
): string {
  const date = (endedAt ?? new Date()).toISOString().slice(0, 10);
  const ext = (format || "wav").toLowerCase() === "mp3" ? "mp3" : "wav";
  const safeId = callId.replace(/[^A-Za-z0-9_-]/g, "");
  return `JillJill_Call_${safeId}_${date}.${ext}`;
}

/** Keep the local-key helper reachable from one import site. */
export { isLocalRecordingKey };
