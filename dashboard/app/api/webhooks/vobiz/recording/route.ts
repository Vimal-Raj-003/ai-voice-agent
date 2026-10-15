// Vobiz recording callback — "the recording for this call is ready".
//
// Configure this URL on the Vobiz trunk (webhook_url + recording_webhook_enabled)
// or per-call via the Record API's callback_url.
//
// ── Signature verification (per vobiz.ai/docs/concepts/validating-callbacks) ──
//   X-Vobiz-Signature-V3 = base64(HMAC-SHA256(key = authToken, msg = baseURL + "." + nonce))
//   X-Vobiz-Signature-V2 = base64(HMAC-SHA256(key = authToken, msg = baseURL + nonce))
// where baseURL is this callback URL with the query string stripped, and the
// nonce arrives in the matching X-Vobiz-Signature-V{2,3}-Nonce header.
//
// IMPORTANT consequence of that scheme: the signature covers the URL and nonce
// ONLY — never the request body. So a valid signature proves the request came
// from Vobiz, but says nothing about the payload's integrity. That is precisely
// why this handler treats the body as untrusted hints and re-reads the
// authoritative recording from GET /Recording/{id}/ before storing anything.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDefaultOrg } from "@/lib/org";
import { getVobizCredentials } from "@/lib/vobiz";
import { applyRecordingWebhook } from "@/lib/vobiz-recording";

/** Base URL Vobiz signed: this endpoint, query stripped. */
function baseUrl(request: Request): string {
  const configured = process.env.VOBIZ_CALLBACK_URL?.trim();
  if (configured) return configured.split("?")[0];
  // Behind a proxy the inbound URL may not match what Vobiz called, which is
  // why VOBIZ_CALLBACK_URL exists; honour forwarded headers as a best effort.
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (proto) u.protocol = `${proto}:`;
  if (host) u.host = host;
  u.search = "";
  return u.toString();
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True when any supported signature header validates against the auth token. */
function verifySignature(request: Request, url: string, authToken: string): boolean {
  const variants: Array<{ sig: string | null; nonce: string | null; join: string }> = [
    {
      sig: request.headers.get("x-vobiz-signature-v3"),
      nonce: request.headers.get("x-vobiz-signature-v3-nonce"),
      join: ".",
    },
    {
      sig: request.headers.get("x-vobiz-signature-v2"),
      nonce: request.headers.get("x-vobiz-signature-v2-nonce"),
      join: "",
    },
  ];
  for (const v of variants) {
    if (!v.sig || !v.nonce) continue;
    const expected = createHmac("sha256", authToken)
      .update(`${url}${v.join}${v.nonce}`, "utf8")
      .digest("base64");
    if (constantTimeEquals(v.sig.trim(), expected)) return true;
  }
  return false;
}

/** Pull provider identifiers out of the payload, whatever casing it uses. */
function identifiers(body: Record<string, unknown>) {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  // The RecordStop/recording.completed payload shape is not fully documented,
  // so every plausible documented spelling is accepted. These are only used to
  // LOCATE the call; the recording data itself is re-read from the API.
  return {
    recordingId: pick("recording_id", "RecordingID", "RecordingId", "recordingId"),
    callUuid: pick("call_uuid", "CallUUID", "CallUuid", "callUuid"),
    sipCallId: pick("sip_call_id", "SipCallId", "sipCallId"),
  };
}

export async function POST(request: Request) {
  // The org whose auth token signs the callback. Vobiz is configured per
  // organisation, so resolve the credential before anything else. Resolved the
  // same way every other route does it — an env-var fallback would silently
  // look up the wrong org and report "not configured".
  const org = await getDefaultOrg();
  const creds = await getVobizCredentials(org.id);
  if (!creds) {
    // Nothing to verify against: refuse rather than accept unauthenticated data.
    return Response.json({ ok: false, error: "vobiz not configured" }, { status: 503 });
  }

  if (!verifySignature(request, baseUrl(request), creds.authToken)) {
    // Missing or wrong signature — reject, per the docs' own guidance.
    return Response.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = (await request.json()) as Record<string, unknown>;
    } else {
      body = Object.fromEntries((await request.formData()) as unknown as Iterable<[string, string]>);
    }
  } catch {
    return Response.json({ ok: false, error: "unreadable body" }, { status: 400 });
  }

  const ids = identifiers(body);
  if (!ids.recordingId && !ids.callUuid && !ids.sipCallId) {
    // Acknowledge: retrying this will not help, and a 4xx would make Vobiz
    // redeliver an event we can never match.
    return Response.json({ ok: true, matched: false, reason: "no identifiers" });
  }

  const outcome = await applyRecordingWebhook(ids);

  // Always 200 on a verified callback we have consumed, so Vobiz does not retry
  // a terminal case. Transient failures stay PROCESSING and are retried by the
  // lazy fallback instead.
  return Response.json({ ok: outcome.ok, status: outcome.status });
}

/** Reachability check for configuring the URL in the Vobiz console. */
export async function GET() {
  const org = await getDefaultOrg();
  const configured = !!(await getVobizCredentials(org.id));
  // Deliberately reveals nothing beyond whether the endpoint is wired up.
  return Response.json({ endpoint: "vobiz recording callback", configured });
}

export const dynamic = "force-dynamic";
