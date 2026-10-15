// Associate a finished call with its Vobiz recording. SERVER ONLY.
//
// Runs strictly after the call: nothing in here is reachable from the voice
// event loop, and the worker never calls it. Two triggers, same code path:
//
//   * the Vobiz recording webhook (preferred — it fires when the file is ready)
//   * a lazy, bounded fallback when the webhook never arrives, attempted when
//     the Calls page asks about a recording that is still unresolved
//
// The fallback is bounded by the post-call processing window (see
// shouldAttemptVobizLookup), so it stops on READY, on FAILED, or on timeout —
// never an unbounded poll, and never a background daemon.
//
// Matching is deterministic: calls."sipCallId" (LiveKit `sip.callIDFull`) →
// GET /cdr?sip_call_id=… → `uuid` → the recording with that `call_uuid`.
// Phone number and timestamp are never used to pair a recording to a call.
import { prisma } from "@/lib/prisma";
import {
  getVobizCredentials,
  findCdrBySipCallId,
  findRecordingByCallUuid,
  getRecording,
  safeError,
  type VobizRecording,
} from "@/lib/vobiz";
import {
  shouldAttemptVobizLookup,
  withinProcessingWindow,
  type ResolvableCall,
} from "@/lib/recording-source";

const SELECT = {
  id: true,
  organizationId: true,
  recordingStatus: true,
  recordingObjectKey: true,
  providerCallId: true,
  providerRecordingId: true,
  providerRecordingStatus: true,
  providerRecordingUrl: true,
  recordingSource: true,
  telephonyProvider: true,
  sipCallId: true,
  endedAt: true,
} as const;

/** Seconds from the recording object, preferring the precise millisecond field. */
export function recordingSeconds(r: VobizRecording): number | null {
  const ms = Number(r.recording_duration_ms);
  if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 1000);
  if (typeof r.rounded_recording_duration === "number" && r.rounded_recording_duration > 0) {
    return r.rounded_recording_duration;
  }
  return null;
}

/** Persist a resolved Vobiz recording against a call. */
async function storeRecording(callId: string, r: VobizRecording): Promise<void> {
  const seconds = recordingSeconds(r);
  await prisma.call.update({
    where: { id: callId },
    data: {
      providerCallId: r.call_uuid || undefined,
      providerRecordingId: r.recording_id,
      providerRecordingUrl: r.recording_url,
      providerRecordingStatus: "READY",
      recordingSource: "VOBIZ",
      // Only fill duration when Vobiz gives one; never overwrite a good local
      // value with null.
      ...(seconds ? { recordingDurationSeconds: seconds } : {}),
    },
  });
}

export type ResolveOutcome =
  | { ok: true; status: "READY"; recordingId: string }
  | { ok: false; status: "PROCESSING" | "FAILED" | "SKIPPED"; reason: string };

/**
 * Try to attach the Vobiz recording for one call.
 *
 * Never throws: a provider outage must not break the Calls page, and must never
 * disturb the local fallback. Errors are recorded as PROCESSING while the
 * window is open (so a transient 5xx is retried) and FAILED once it closes.
 */
export async function resolveVobizRecordingForCall(
  callId: string,
  opts: { force?: boolean } = {},
): Promise<ResolveOutcome> {
  let call: (ResolvableCall & { id: string; organizationId: string }) | null = null;
  try {
    call = (await prisma.call.findUnique({ where: { id: callId }, select: SELECT })) as
      | (ResolvableCall & { id: string; organizationId: string })
      | null;
  } catch (e) {
    return { ok: false, status: "SKIPPED", reason: safeError(e) };
  }
  if (!call) return { ok: false, status: "SKIPPED", reason: "call not found" };

  if (call.providerRecordingStatus === "READY" && call.providerRecordingUrl) {
    return { ok: true, status: "READY", recordingId: call.providerRecordingId ?? "" };
  }
  if (!opts.force && !shouldAttemptVobizLookup(call)) {
    return { ok: false, status: "SKIPPED", reason: "outside lookup window or no SIP call id" };
  }

  const creds = await getVobizCredentials(call.organizationId);
  if (!creds) {
    return { ok: false, status: "SKIPPED", reason: "vobiz credentials not configured" };
  }

  try {
    // Reuse a call_uuid already known (from the webhook); otherwise derive it
    // from the SIP Call-ID via the CDR.
    let callUuid = call.providerCallId || "";
    if (!callUuid) {
      if (!call.sipCallId) {
        return { ok: false, status: "SKIPPED", reason: "no sipCallId to match on" };
      }
      const cdr = await findCdrBySipCallId(call.organizationId, call.sipCallId, creds);
      if (!cdr?.uuid) {
        return await markPending(call, "no CDR for this SIP call id yet");
      }
      callUuid = cdr.uuid;
      await prisma.call.update({
        where: { id: call.id },
        data: { providerCallId: callUuid },
      });
    }

    const rec = await findRecordingByCallUuid(call.organizationId, callUuid, creds);
    if (!rec?.recording_url) {
      return await markPending(call, "recording not listed yet");
    }
    await storeRecording(call.id, rec);
    return { ok: true, status: "READY", recordingId: rec.recording_id };
  } catch (e) {
    return await markPending(call, safeError(e, creds));
  }
}

/**
 * Record that we tried and the recording was not there yet. Stays PROCESSING
 * while the window is open so the next view retries; flips to FAILED when the
 * window closes, which is the "timeout" terminal state.
 */
async function markPending(
  call: ResolvableCall & { id: string },
  reason: string,
): Promise<ResolveOutcome> {
  const stillWaiting = withinProcessingWindow(call);
  const status = stillWaiting ? "PROCESSING" : "FAILED";
  try {
    await prisma.call.update({
      where: { id: call.id },
      data: { providerRecordingStatus: status },
    });
  } catch {
    /* status bookkeeping only — never surface */
  }
  return { ok: false, status, reason };
}

/**
 * Webhook entry point: Vobiz told us a recording is ready.
 *
 * The RecordStop callback payload is not fully documented, so the webhook is
 * treated as a TRIGGER carrying identifiers, and the authoritative record is
 * re-read from GET /Recording/{recording_id}/. That way nothing depends on an
 * undocumented payload shape.
 */
export async function applyRecordingWebhook(args: {
  recordingId?: string | null;
  callUuid?: string | null;
  sipCallId?: string | null;
}): Promise<ResolveOutcome> {
  const { recordingId, callUuid, sipCallId } = args;

  // Locate the call by the most specific identifier available. All three are
  // provider-issued keys — no number/timestamp fallback.
  const or: Array<Record<string, string>> = [];
  if (callUuid) or.push({ providerCallId: callUuid });
  if (sipCallId) or.push({ sipCallId });
  if (recordingId) or.push({ providerRecordingId: recordingId });
  if (or.length === 0) return { ok: false, status: "SKIPPED", reason: "no identifier in payload" };

  let call: { id: string; organizationId: string } | null = null;
  try {
    call = await prisma.call.findFirst({
      where: { OR: or },
      select: { id: true, organizationId: true },
      orderBy: { createdAt: "desc" },
    });
  } catch (e) {
    return { ok: false, status: "SKIPPED", reason: safeError(e) };
  }
  if (!call) return { ok: false, status: "SKIPPED", reason: "no matching call" };

  // Preferred path: we were handed a recording id, so read that record directly.
  if (recordingId) {
    const creds = await getVobizCredentials(call.organizationId);
    if (!creds) return { ok: false, status: "SKIPPED", reason: "vobiz credentials not configured" };
    try {
      const rec = await getRecording(call.organizationId, recordingId, creds);
      if (rec?.recording_url) {
        await storeRecording(call.id, rec);
        return { ok: true, status: "READY", recordingId: rec.recording_id };
      }
    } catch (e) {
      return { ok: false, status: "PROCESSING", reason: safeError(e, creds) };
    }
  }

  // Otherwise fall through to the normal resolution, forced (the webhook is
  // itself the signal that the file exists).
  return resolveVobizRecordingForCall(call.id, { force: true });
}
