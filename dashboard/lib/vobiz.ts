// Vobiz telephony API — SERVER ONLY.
//
// Vobiz records the PSTN leg itself, at better quality than the locally mixed
// WAV (its copy is the real carrier audio, stereo, 8 kHz). This module fetches
// that recording after the call so JillJill can serve it.
//
// Everything here is server-side by construction: the Auth ID and Auth Token
// are decrypted from provider_credentials, used only in outbound request
// headers, and never returned to a caller, never logged, never embedded in a
// URL handed to a browser. `recording_url` is NOT a public link — it needs the
// same headers — which is exactly why playback is proxied rather than
// redirected.
//
// ── Endpoints used (verified against https://vobiz.ai/openapi.json, OpenAPI
//    3.0.3) — nothing here is invented: ──────────────────────────────────────
//   GET /api/v1/Account/{auth_id}/cdr?sip_call_id=…      → CDR, field `uuid`
//   GET /api/v1/Account/{auth_id}/Recording/             → list (limit/offset)
//   GET /api/v1/Account/{auth_id}/Recording/{id}/        → one recording
//
// Two spec facts shape the design:
//   * The Recording LIST endpoint takes ONLY `limit`/`offset` — there is no
//     call_uuid filter — so a lookup by call must page and match client-side.
//   * The spec has NO download endpoint (the prose docs imply one, but no path
//     exists). Audio therefore comes from the `recording_url` field.
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/credential-crypto";

const BASE = "https://api.vobiz.ai";
const PROVIDER = "vobiz";

/** Recording object fields we rely on (names exactly as the spec returns them). */
export type VobizRecording = {
  recording_id: string;
  call_uuid: string;
  recording_url: string;
  recording_format: string | null;
  recording_type: string | null;
  recording_duration_ms: string | null;
  rounded_recording_duration: number | null;
  add_time: string | null;
  from_number: string | null;
  to_number: string | null;
};

/** CDR fields we rely on. `uuid` is the Vobiz call UUID. */
export type VobizCdr = {
  uuid: string;
  sip_call_id: string | null;
  bridge_uuid: string | null;
  duration: number | null;
  billsec: number | null;
  destination_number: string | null;
  caller_id_number: string | null;
  start_time: string | null;
  end_time: string | null;
};

type Creds = { authId: string; authToken: string };

/**
 * Decrypt the org's Vobiz credentials.
 *
 * Stored as ONE encrypted JSON blob under provider "vobiz" — the same
 * json-credential shape the registry already uses for service accounts —
 * because Vobiz needs two values and the store holds one ciphertext per
 * provider:  {"auth_id": "MA_…", "auth_token": "…"}
 *
 * Returns null (never throws) when unconfigured, so every caller can degrade to
 * the local recording instead of erroring.
 */
export async function getVobizCredentials(orgId: string): Promise<Creds | null> {
  let row: { ciphertext: string } | null = null;
  try {
    row = await prisma.providerCredential.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: PROVIDER } },
      select: { ciphertext: true },
    });
  } catch {
    return null;
  }
  if (!row?.ciphertext) return null;
  try {
    const parsed = JSON.parse(decryptSecret(row.ciphertext));
    const authId = String(parsed.auth_id ?? parsed.authId ?? "").trim();
    const authToken = String(parsed.auth_token ?? parsed.authToken ?? "").trim();
    if (!authId || !authToken) return null;
    return { authId, authToken };
  } catch {
    // Malformed/undecryptable: treat as unconfigured. Deliberately no detail in
    // the message — it must never echo any part of the ciphertext or key.
    return null;
  }
}

export function vobizConfigured(c: Creds | null): c is Creds {
  return !!c;
}

/** Headers for an authenticated Vobiz call. Never logged. */
function authHeaders(c: Creds): Record<string, string> {
  return {
    "X-Auth-ID": c.authId,
    "X-Auth-Token": c.authToken,
    Accept: "application/json",
  };
}

/** Strip anything credential-shaped out of a message before it can be stored. */
export function safeError(e: unknown, c?: Creds | null): string {
  let msg = e instanceof Error ? e.message : String(e);
  if (c) {
    for (const secret of [c.authToken, c.authId]) {
      if (secret) msg = msg.split(secret).join("[redacted]");
    }
  }
  return msg.slice(0, 300);
}

async function getJson<T>(path: string, c: Creds, timeoutMs = 12000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: authHeaders(c),
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) {
      // Status only — a Vobiz error body could echo request context.
      throw new Error(`vobiz ${path.split("?")[0]} returned HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the Vobiz CDR for a call by its SIP Call-ID.
 *
 * This is the deterministic join: LiveKit exposes the trunk provider's SIP
 * Call-ID as the `sip.callIDFull` participant attribute (stored by the worker
 * in calls."sipCallId"), and Vobiz accepts that same value as the `sip_call_id`
 * CDR filter. No number/timestamp matching is involved.
 */
export async function findCdrBySipCallId(
  orgId: string,
  sipCallId: string,
  creds?: Creds | null,
): Promise<VobizCdr | null> {
  const c = creds ?? (await getVobizCredentials(orgId));
  if (!c) return null;
  const q = new URLSearchParams({ sip_call_id: sipCallId, per_page: "5" });
  const body = await getJson<{ data?: VobizCdr[] }>(
    `/api/v1/Account/${encodeURIComponent(c.authId)}/cdr?${q}`,
    c,
  );
  const rows = Array.isArray(body?.data) ? body.data : [];
  // Defensive: only accept a row that really carries this SIP Call-ID, so a
  // server-side filter change can never silently return an unrelated call.
  const exact = rows.find((r) => r?.sip_call_id === sipCallId);
  return exact ?? null;
}

/** Retrieve one recording by id. */
export async function getRecording(
  orgId: string,
  recordingId: string,
  creds?: Creds | null,
): Promise<VobizRecording | null> {
  const c = creds ?? (await getVobizCredentials(orgId));
  if (!c) return null;
  return getJson<VobizRecording>(
    `/api/v1/Account/${encodeURIComponent(c.authId)}/Recording/${encodeURIComponent(recordingId)}/`,
    c,
  );
}

/**
 * Find the recording belonging to a Vobiz call UUID.
 *
 * The list endpoint cannot filter by call_uuid (limit/offset only), so this
 * pages from newest and matches client-side. Bounded on purpose: a recording
 * for a call that just ended sits at the top, and an unbounded walk over an
 * account's whole history would be a denial-of-service against ourselves.
 */
export async function findRecordingByCallUuid(
  orgId: string,
  callUuid: string,
  creds?: Creds | null,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<VobizRecording | null> {
  const c = creds ?? (await getVobizCredentials(orgId));
  if (!c) return null;
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 5;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
    const body = await getJson<{ objects?: VobizRecording[]; data?: VobizRecording[] }>(
      `/api/v1/Account/${encodeURIComponent(c.authId)}/Recording/?${q}`,
      c,
    );
    const rows = body?.objects ?? body?.data ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const hit = rows.find((r) => r?.call_uuid === callUuid);
    if (hit) return hit;
    if (rows.length < pageSize) return null; // last page reached
  }
  return null;
}

/**
 * Fetch the recording audio itself, passing a Range header through so the
 * browser's <audio> element can seek.
 *
 * `recording_url` requires the auth headers, so this is the only way the bytes
 * can be served without exposing credentials to the browser.
 */
export async function fetchRecordingAudio(
  recordingUrl: string,
  creds: Creds,
  init?: { range?: string | null },
): Promise<Response> {
  const headers: Record<string, string> = authHeaders(creds);
  delete headers.Accept;
  if (init?.range) headers.Range = init.range;
  return fetch(recordingUrl, { headers, cache: "no-store", redirect: "follow" });
}

/** Content type for a Vobiz recording_format value. */
export function audioContentType(format: string | null | undefined): string {
  return (format || "").toLowerCase() === "mp3" ? "audio/mpeg" : "audio/wav";
}
