import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 (S3-compatible) access for PRIVATE call recordings. The bucket
// stays private: the DB stores only the object key, and the dashboard mints
// short-lived signed GET URLs on demand (playback + download). Credentials live
// ONLY here, server-side, and are never returned to the browser.
//
// Env (exact names, shared with the voice-service that writes the recordings):
//   R2_ACCOUNT_ID          — Cloudflare account id (used to derive the endpoint)
//   R2_ACCESS_KEY_ID       — R2 access key
//   R2_SECRET_ACCESS_KEY   — R2 secret
//   R2_BUCKET              — bucket name
//   R2_ENDPOINT            — full S3 endpoint (optional if R2_ACCOUNT_ID is set)
//   R2_PUBLIC_BASE_URL     — optional; only for public-bucket mode (unused here)

const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET = process.env.R2_BUCKET || "";
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ENDPOINT =
  process.env.R2_ENDPOINT ||
  (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : "");

export function isR2Configured(): boolean {
  return Boolean(ACCESS_KEY && SECRET_KEY && BUCKET && ENDPOINT);
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  return _client;
}

// Short-lived signed GET URL for an R2 object. `download` adds a
// Content-Disposition: attachment response override with `filename` so the
// browser saves (rather than streams) the file. Default TTL 5 minutes.
export async function signRecordingUrl(
  objectKey: string,
  opts: { download?: boolean; filename?: string; expiresIn?: number } = {},
): Promise<string> {
  const { download = false, filename, expiresIn = 300 } = opts;
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
    ...(download
      ? { ResponseContentDisposition: `attachment; filename="${(filename || objectKey.split("/").pop() || "recording").replace(/"/g, "")}"` }
      : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn });
}
