import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { isR2Configured, signRecordingUrl } from "@/lib/r2";
import { isLocalRecordingKey, isLocalBackend } from "@/lib/recordings";
import { resolveRecording, shouldAttemptVobizLookup } from "@/lib/recording-source";
import { resolveVobizRecordingForCall } from "@/lib/vobiz-recording";

// Recording status + a SHORT-LIVED signed playback URL for one call. The bucket
// stays private — this route is the only way the browser gets a playable URL,
// and it is session-gated + org-scoped. Credentials never leave the server.
//
// Status (recordingStatus column, else inferred):
//   NOT_CONFIGURED | STARTING | RECORDING | PROCESSING | READY | FAILED

export function recordingFilename(call: { id: string; createdAt: Date | null; recordingObjectKey?: string | null }): string {
  const ext = (call.recordingObjectKey?.split(".").pop() || "ogg").replace(/[^a-z0-9]/gi, "") || "ogg";
  const d = call.createdAt ? new Date(call.createdAt) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `JillJill_Call_${call.id}_${stamp}.${ext}`;
}

// Normalise the stored status, inferring a sensible value for legacy rows that
// predate the recordingStatus column.
export function effectiveStatus(call: {
  recordingStatus?: string | null; recordingObjectKey?: string | null; recordingUrl?: string | null;
}): "NOT_CONFIGURED" | "STARTING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED" | "NONE" {
  const s = (call.recordingStatus || "").toUpperCase();
  // Legacy rows: calls made BEFORE self-hosted recording existed were stamped
  // NOT_CONFIGURED by the old Cloudflare R2 path. That is no longer a
  // configuration problem — local recording is configured — the call simply has
  // no audio. Report it as NONE so the UI stops telling the operator to fix env
  // vars that are already correct. (A genuine local failure is written as
  // FAILED by the worker, so it is unaffected.)
  if (s === "NOT_CONFIGURED" && !call.recordingObjectKey && isLocalBackend()) return "NONE";
  if (["NOT_CONFIGURED", "STARTING", "RECORDING", "PROCESSING", "READY", "FAILED"].includes(s)) {
    return s as "NOT_CONFIGURED" | "STARTING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED";
  }
  // Legacy inference: a stored object/URL means the recording finished.
  if (call.recordingObjectKey || call.recordingUrl) return "READY";
  return "NONE";
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const org = await getDefaultOrg();

  const SELECT = {
    id: true, createdAt: true, endedAt: true, durationSeconds: true,
    recordingStatus: true, recordingObjectKey: true, recordingUrl: true,
    recordingDurationSeconds: true, recordingEgressId: true, recordingError: true,
    providerRecordingStatus: true, providerRecordingUrl: true, providerRecordingId: true,
    providerCallId: true, recordingSource: true, telephonyProvider: true, sipCallId: true,
  } as const;

  let call = await prisma.call.findFirst({
    where: { id, organizationId: org.id },           // tenant authorization
    select: SELECT,
  });
  if (!call) return Response.json({ error: "not found" }, { status: 404 });

  // ── Bounded fallback for a missed recording webhook ──────────────────────
  // Attempted only post-call, only inside the processing window, and only when
  // the deterministic SIP Call-ID key exists — so this is not a poll loop and
  // cannot run during a live call. Failures leave the local fallback intact.
  if (shouldAttemptVobizLookup(call)) {
    const outcome = await resolveVobizRecordingForCall(call.id);
    if (outcome.ok) {
      call = (await prisma.call.findFirst({
        where: { id, organizationId: org.id },
        select: SELECT,
      })) ?? call;
    }
  }

  const resolved = resolveRecording(call);
  const status = resolved.source === "VOBIZ" ? "READY" : effectiveStatus(call);
  const filename = recordingFilename(call);
  const durationSeconds = call.recordingDurationSeconds ?? call.durationSeconds ?? null;

  let playbackUrl: string | null = null;
  if (resolved.source === "VOBIZ") {
    // Vobiz's own copy. Served through our proxy because `recording_url`
    // requires the X-Auth-ID/X-Auth-Token headers — the browser must never see
    // those, so a redirect is not an option.
    playbackUrl = `/api/calls/${call.id}/recording/stream`;
  } else if (status === "READY") {
    if (isLocalRecordingKey(call.recordingObjectKey)) {
      // Self-hosted recording: stream it through our own session-gated proxy.
      // No R2 credentials are involved.
      playbackUrl = `/api/calls/${call.id}/recording/stream`;
    } else if (call.recordingObjectKey && isR2Configured()) {
      // 1h window so seeking through a long recording keeps working.
      try { playbackUrl = await signRecordingUrl(call.recordingObjectKey, { download: false, expiresIn: 3600 }); }
      catch (err) { return Response.json({ status: "FAILED", error: `signing failed: ${err instanceof Error ? err.message : String(err)}`, durationSeconds, filename }); }
    } else if (call.recordingUrl && /^https?:\/\//i.test(call.recordingUrl)) {
      // Backward-compat: a legacy public URL plays directly.
      playbackUrl = call.recordingUrl;
    }
  }

  // A Vobiz call still waiting on its recording reports PROCESSING rather than
  // NONE, so the UI can say "Recording processing…" instead of "No recording".
  const reported = resolved.status === "PROCESSING" && status === "NONE"
    ? "PROCESSING"
    : status === "NONE"
      ? (isR2Configured() || process.env.RECORDING_BACKEND !== "r2" ? "NONE" : "NOT_CONFIGURED")
      : status;

  return Response.json({
    status: reported,
    durationSeconds,
    egressId: call.recordingEgressId ?? null,
    error: call.recordingError ?? null,
    filename,
    hasRecording: Boolean(playbackUrl),
    local: isLocalRecordingKey(call.recordingObjectKey),
    playbackUrl,
    // Which backend is serving, for the "Source: Vobiz" badge. No provider
    // identifiers or credentials are exposed — just the label.
    source: resolved.source,
    sourceLabel: resolved.label,
  });
}
