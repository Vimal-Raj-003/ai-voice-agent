import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { fetchLocalRecording, fetchVobizRecording, isLocalRecordingKey } from "@/lib/recordings";
import { resolveRecording } from "@/lib/recording-source";

// Streams a call recording to the browser from whichever backend holds it:
//
//   VOBIZ -> the carrier's own copy, proxied via voice-service. Vobiz's
//            `recording_url` needs the account's X-Auth-ID/X-Auth-Token, and
//            those live ONLY in voice-service - so the dashboard holds no
//            Vobiz credential and the browser never sees one.
//   LOCAL -> the self-hosted WAV on the voice-service host (unchanged path).
//
// Either way the bytes stay behind the dashboard session + org check, and Range
// headers are honoured so <audio> can seek. Nothing is re-encoded: the response
// is the provider's original container, byte for byte.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const org = await getDefaultOrg();

  const call = await prisma.call.findFirst({
    where: { id, organizationId: org.id },           // tenant authorization
    select: {
      id: true, organizationId: true, endedAt: true,
      recordingStatus: true, recordingObjectKey: true,
      providerRecordingStatus: true, providerRecordingUrl: true,
      providerRecordingId: true, recordingSource: true,
      telephonyProvider: true, sipCallId: true,
    },
  });
  if (!call) return new Response("not found", { status: 404 });

  const range = request.headers.get("range");
  const resolved = resolveRecording(call);

  if (resolved.source === "VOBIZ") {
    return streamVobiz(call.id, range);
  }

  if (!call.recordingObjectKey || !isLocalRecordingKey(call.recordingObjectKey)) {
    return new Response("not found", { status: 404 });
  }

  try {
    const upstream = await fetchLocalRecording(call.recordingObjectKey, { range });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("recording unavailable", { status: upstream.status === 404 ? 404 : 502 });
    }
    const h = new Headers();
    for (const k of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    h.set("Content-Type", "audio/wav");
    h.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch (err) {
    return new Response(`recording proxy failed: ${err instanceof Error ? err.message : String(err)}`, { status: 502 });
  }
}

/**
 * Proxy the Vobiz recording through voice-service.
 *
 * Range is passed along and whatever voice-service returns (200 or 206) is
 * forwarded verbatim, so seeking works and the audio is never re-encoded.
 * voice-service is the only process holding Vobiz credentials; it also covers
 * the case where Vobiz itself ignores a Range header.
 */
async function streamVobiz(callId: string, range: string | null): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchVobizRecording(callId, { range });
  } catch {
    // Our own message - never the provider's body, and no credentials.
    return new Response("recording fetch failed", { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("recording unavailable", {
      status: upstream.status === 404 ? 404 : upstream.status === 503 ? 503 : 502,
    });
  }
  const h = new Headers();
  for (const k of ["content-length", "content-range", "accept-ranges", "content-type"]) {
    const v = upstream.headers.get(k);
    if (v) h.set(k, v);
  }
  if (!h.has("content-type")) h.set("Content-Type", "audio/wav");
  h.set("Cache-Control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: h });
}

/**
 * Parse a single-range `bytes=` header. Returns start=null when unsatisfiable.
 * Exported shape kept simple on purpose: multipart ranges are not something an
 * <audio> element asks for.
 */
export function parseRange(
  header: string,
  size: number,
): { start: number | null; end: number } {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || size <= 0) return { start: null, end: 0 };
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return { start: null, end: 0 };

  // Suffix form: "bytes=-500" means the last 500 bytes.
  if (rawStart === "") {
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return { start: null, end: 0 };
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { start: null, end: 0 };
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return { start: null, end: 0 };
  return { start, end };
}
