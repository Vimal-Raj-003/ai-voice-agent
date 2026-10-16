import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { isR2Configured, signRecordingUrl } from "@/lib/r2";
import { effectiveStatus, recordingFilename } from "../route";
import { fetchLocalRecording, fetchVobizRecording, isLocalRecordingKey } from "@/lib/recordings";
import { resolveRecording, downloadFilename } from "@/lib/recording-source";

// Redirects to a SHORT-LIVED signed download URL (Content-Disposition:
// attachment) for one call's recording. Session-gated + org-scoped. R2
// credentials never leave the server; the browser only ever sees the signed
// URL, which expires in minutes.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const org = await getDefaultOrg();

  const call = await prisma.call.findFirst({
    where: { id, organizationId: org.id },
    select: {
      id: true, organizationId: true, createdAt: true, endedAt: true,
      recordingStatus: true, recordingObjectKey: true, recordingUrl: true,
      providerRecordingStatus: true, providerRecordingUrl: true,
      providerRecordingId: true, recordingSource: true,
      telephonyProvider: true, sipCallId: true,
    },
  });
  if (!call) return new Response("not found", { status: 404 });

  const resolved = resolveRecording(call);

  // ── Vobiz copy (preferred) ────────────────────────────────────────────────
  // Proxied through voice-service, which is the only process holding the Vobiz
  // credentials. Bytes are passed through untouched - no re-encoding, no
  // container rewrite - so the file matches the carrier's original.
  if (resolved.source === "VOBIZ") {
    try {
      const upstream = await fetchVobizRecording(call.id);
      if (!upstream.ok) {
        return new Response("recording unavailable", {
          status: upstream.status === 404 ? 404 : upstream.status === 503 ? 503 : 502,
        });
      }
      const ctype = upstream.headers.get("content-type") || "audio/wav";
      const name = downloadFilename(
        call.id, call.endedAt ?? call.createdAt,
        ctype.includes("mpeg") ? "mp3" : "wav",
      );
      const h = new Headers({
        "Content-Type": ctype,
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      });
      const len = upstream.headers.get("content-length");
      if (len) h.set("Content-Length", len);
      return new Response(upstream.body, { status: 200, headers: h });
    } catch {
      return new Response("download failed", { status: 502 });
    }
  }

  if (effectiveStatus(call) !== "READY") return new Response("recording not ready", { status: 409 });

  const filename = recordingFilename(call);

  // SELF-HOSTED recording: stream the bytes through this route as an
  // attachment. No bucket, no signed URL, no Cloudflare R2 credentials.
  if (isLocalRecordingKey(call.recordingObjectKey)) {
    try {
      const upstream = await fetchLocalRecording(call.recordingObjectKey!);
      if (!upstream.ok) return new Response("recording unavailable", { status: 404 });
      const h = new Headers({
        "Content-Type": "audio/wav",
        "Content-Disposition": `attachment; filename="${filename.replace(/\.[^.]+$/, "")}.wav"`,
        "Cache-Control": "no-store",
      });
      const len = upstream.headers.get("content-length");
      if (len) h.set("Content-Length", len);
      return new Response(upstream.body, { status: 200, headers: h });
    } catch (err) {
      return new Response(`download failed: ${err instanceof Error ? err.message : String(err)}`, { status: 502 });
    }
  }

  let url: string | null = null;
  if (call.recordingObjectKey && isR2Configured()) {
    try { url = await signRecordingUrl(call.recordingObjectKey, { download: true, filename }); }
    catch (err) { return new Response(`signing failed: ${err instanceof Error ? err.message : String(err)}`, { status: 500 }); }
  } else if (call.recordingUrl && /^https?:\/\//i.test(call.recordingUrl)) {
    url = call.recordingUrl;
  }
  if (!url) return new Response("recording unavailable", { status: 404 });

  return Response.redirect(url, 302);
}
