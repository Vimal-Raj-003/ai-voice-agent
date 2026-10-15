import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { fetchLocalRecording, isLocalRecordingKey } from "@/lib/recordings";

// Delete ONE call recording: removes the file on the voice-service host and
// clears the recording columns on the call row. The call, its transcript and all
// other data are untouched. Session-gated + org-scoped. Confirmation happens in
// the UI; this endpoint performs the delete.
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const org = await getDefaultOrg();

  const call = await prisma.call.findFirst({
    where: { id, organizationId: org.id },
    select: { id: true, recordingObjectKey: true },
  });
  if (!call) return Response.json({ error: "not found" }, { status: 404 });

  const key = call.recordingObjectKey;
  let fileDeleted = false;
  let note: string | null = null;

  if (key && isLocalRecordingKey(key)) {
    try {
      const r = await fetchLocalRecording(key, { method: "DELETE" });
      fileDeleted = r.ok;
      if (!r.ok) note = `voice-service returned ${r.status}`;
    } catch (err) {
      note = err instanceof Error ? err.message : String(err);
    }
  } else if (key) {
    // Legacy Cloudflare R2 object: we deliberately do NOT delete remote objects
    // here — existing cloud recordings are migrated/removed only on request.
    note = "legacy R2 recording: file left in place, row cleared";
  }

  await prisma.call.update({
    where: { id: call.id },
    data: {
      recordingStatus: "NONE",
      recordingObjectKey: null,
      recordingUrl: null,
      recordingDurationSeconds: null,
      recordingError: null,
    },
  });

  return Response.json({ ok: true, fileDeleted, note });
}
