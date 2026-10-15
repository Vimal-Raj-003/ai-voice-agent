import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { fetchLocalRecording, isLocalRecordingKey } from "@/lib/recordings";
import { resolveRecording } from "@/lib/recording-source";
import { getVobizCredentials, fetchRecordingAudio, audioContentType } from "@/lib/vobiz";

// Streams a call recording to the browser from whichever backend holds it:
//
//   VOBIZ -> the carrier's own copy, proxied here because Vobiz's
//            `recording_url` requires X-Auth-ID/X-Auth-Token headers. Those
//            must never reach the browser, so redirecting is not an option.
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
    return streamVobiz(call.organizationId, call.providerRecordingUrl!, range);
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

/** Largest response we are willing to buffer in order to satisfy a Range. */
const MAX_SLICE_BYTES = 64 * 1024 * 1024;

/**
 * Proxy the Vobiz recording, preserving seek.
 *
 * Vobiz's Range support is not documented, so both cases are handled: the
 * header is passed upstream, and if the upstream answers 200 (ignoring it) the
 * requested slice is cut here and returned as a correct 206. That keeps seeking
 * working either way, at the cost of buffering one response — bounded by
 * MAX_SLICE_BYTES, which an 8 kHz call recording is nowhere near.
 */
async function streamVobiz(
  orgId: string,
  recordingUrl: string,
  range: string | null,
): Promise<Response> {
  const creds = await getVobizCredentials(orgId);
  if (!creds) return new Response("recording unavailable", { status: 503 });

  let upstream: Response;
  try {
    upstream = await fetchRecordingAudio(recordingUrl, creds, { range });
  } catch {
    // Message is ours, never the provider's body, and carries no credentials.
    return new Response("recording fetch failed", { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("recording unavailable", { status: upstream.status === 404 ? 404 : 502 });
  }

  const ctype = upstream.headers.get("content-type")
    || audioContentType(recordingUrl.split(".").pop());

  // Upstream honoured the Range: pass it straight through, no buffering.
  if (upstream.status === 206) {
    const h = new Headers({ "Content-Type": ctype, "Cache-Control": "no-store" });
    for (const k of ["content-length", "content-range"]) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    h.set("Accept-Ranges", "bytes");
    return new Response(upstream.body, { status: 206, headers: h });
  }

  // No Range asked for: stream the whole file, but advertise Range support so
  // the browser knows it may seek.
  if (!range) {
    const h = new Headers({ "Content-Type": ctype, "Cache-Control": "no-store", "Accept-Ranges": "bytes" });
    const len = upstream.headers.get("content-length");
    if (len) h.set("Content-Length", len);
    return new Response(upstream.body, { status: 200, headers: h });
  }

  // Range asked for but ignored upstream — satisfy it ourselves.
  const declared = Number(upstream.headers.get("content-length") || "0");
  if (declared > MAX_SLICE_BYTES) {
    // Too large to buffer: hand back the full body rather than failing.
    const h = new Headers({ "Content-Type": ctype, "Cache-Control": "no-store", "Accept-Ranges": "bytes" });
    h.set("Content-Length", String(declared));
    return new Response(upstream.body, { status: 200, headers: h });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  const { start, end } = parseRange(range, buf.length);
  if (start === null) {
    return new Response("range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${buf.length}` },
    });
  }
  const slice = buf.subarray(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": ctype,
      "Content-Length": String(slice.length),
      "Content-Range": `bytes ${start}-${end}/${buf.length}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
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
