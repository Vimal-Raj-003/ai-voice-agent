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
const VOICE_TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

/** Server-side fetch of a recording from the voice-service (Range passthrough). */
export async function fetchLocalRecording(
  key: string,
  init?: { range?: string | null; method?: "GET" | "DELETE" },
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${VOICE_TOKEN}` };
  if (init?.range) headers["Range"] = init.range;
  return fetch(`${VOICE_URL}/api/recordings/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: init?.method ?? "GET",
    headers,
    cache: "no-store",
  });
}

/** True when NEW recordings are captured locally (the default). */
export function isLocalBackend(): boolean {
  return (process.env.RECORDING_BACKEND || "local").toLowerCase() !== "r2";
}
