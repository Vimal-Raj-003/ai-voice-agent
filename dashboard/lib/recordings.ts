// Self-hosted (local-disk) recordings live on the voice-service host, NOT in
// Cloudflare R2. The dashboard runs in a separate container, so it proxies the
// bytes through its own session-gated routes instead of handing the browser a
// signed bucket URL.
//
// Distinguishing the two backends from the stored key alone:
//   R2    -> "recordings/2026/10/12/<room>.ogg"   (written by the Egress upload)
//   local -> "2026/10/12/<room>.wav"              (written by recorder.py)
// so a key that does NOT start with "recordings/" is a local file.
export function isLocalRecordingKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return !key.startsWith("recordings/");
}

const VOICE_URL = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const REMOTE_VOICE_FALLBACK = process.env.REMOTE_VOICE_SERVICE_URL || "https://call.jilljill.in";
const VOICE_TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

/** Server-side fetch of a recording from the voice-service (Range passthrough + remote worker fallback). */
export async function fetchLocalRecording(
  key: string,
  init?: { range?: string | null; method?: "GET" | "DELETE" },
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${VOICE_TOKEN}` };
  if (init?.range) headers["Range"] = init.range;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const method = init?.method ?? "GET";

  const primary = await fetch(`${VOICE_URL}/api/recordings/${encodedKey}`, {
    method,
    headers,
    cache: "no-store",
  });

  if (
    primary.status === 404 &&
    method === "GET" &&
    (VOICE_URL.includes("127.0.0.1") || VOICE_URL.includes("localhost")) &&
    REMOTE_VOICE_FALLBACK &&
    REMOTE_VOICE_FALLBACK !== VOICE_URL
  ) {
    try {
      const remote = await fetch(`${REMOTE_VOICE_FALLBACK}/api/recordings/${encodedKey}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      if (remote.ok || remote.status === 206) {
        return remote;
      }
    } catch {
      // Fall back to primary 404 response
    }
  }
  return primary;
}

/** True when NEW recordings are captured locally (the default). */
export function isLocalBackend(): boolean {
  return (process.env.RECORDING_BACKEND || "local").toLowerCase() !== "r2";
}

export function recordingFilename(call: {
  id: string;
  createdAt: Date | null;
  recordingObjectKey?: string | null;
}): string {
  const ext = (call.recordingObjectKey?.split(".").pop() || "ogg").replace(/[^a-z0-9]/gi, "") || "ogg";
  const d = call.createdAt ? new Date(call.createdAt) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `JillJill_Call_${call.id}_${stamp}.${ext}`;
}

export function effectiveStatus(call: {
  recordingStatus?: string | null;
  recordingObjectKey?: string | null;
  recordingUrl?: string | null;
}): "NOT_CONFIGURED" | "STARTING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED" | "NONE" {
  const s = (call.recordingStatus || "").toUpperCase();
  if (s === "NOT_CONFIGURED" && !call.recordingObjectKey && isLocalBackend()) return "NONE";
  if (["NOT_CONFIGURED", "STARTING", "RECORDING", "PROCESSING", "READY", "FAILED"].includes(s)) {
    return s as "NOT_CONFIGURED" | "STARTING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED";
  }
  if (call.recordingObjectKey || call.recordingUrl) return "READY";
  return "NONE";
}

/**
 * Server-side fetch of a VOBIZ (carrier) recording, proxied through
 * voice-service (Range passthrough).
 *
 * The dashboard deliberately holds NO Vobiz credentials. Vobiz's recording_url
 * only works with the account's X-Auth-ID/X-Auth-Token headers, and those live
 * solely in voice-service — so the chain is:
 *
 *   browser → dashboard (session + org check) → voice-service (bearer) → Vobiz
 *
 * which is the same shape already used for local recordings.
 */
export async function fetchVobizRecording(
  callId: string,
  init?: { range?: string | null },
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${VOICE_TOKEN}` };
  if (init?.range) headers["Range"] = init.range;
  return fetch(`${VOICE_URL}/api/recordings/vobiz/${encodeURIComponent(callId)}`, {
    headers,
    cache: "no-store",
  });
}
