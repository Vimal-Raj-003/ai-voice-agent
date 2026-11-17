import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { isR2Configured, signRecordingUrl } from "@/lib/r2";
import { isLocalRecordingKey, recordingFilename, effectiveStatus } from "@/lib/recordings";
import { resolveRecording } from "@/lib/recording-source";

// Recording status + a SHORT-LIVED signed playback URL for one call. The bucket
// stays private — this route is the only way the browser gets a playable URL,
// and it is session-gated + org-scoped. Credentials never leave the server.
//
// Status (recordingStatus column, else inferred):
//   NOT_CONFIGURED | STARTING | RECORDING | PROCESSING | READY | FAILED

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

  const call = await prisma.call.findFirst({
    where: { id, organizationId: org.id },           // tenant authorization
    select: SELECT,
  });
  if (!call) return Response.json({ error: "not found" }, { status: 404 });

  // Vobiz recordings are resolved by voice-service, which owns the Vobiz API
  // credentials and runs the bounded post-call retry chain (see
  // voice-service/vobiz.py). This route therefore just READS what that landed
  // in the DB — no provider call, and nothing to do during a live call.
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
