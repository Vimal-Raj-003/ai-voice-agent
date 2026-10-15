// Validate a provider credential against the REAL vendor API.
//
// The rule this file exists to enforce: a credential is only reported working
// when a live request to the vendor succeeded. Anything else is reported as
// "unverified" or as the actual failure — never as success. Storing a key is
// not evidence that it works.
//
// Auth schemes below were read from the installed LiveKit plugins (Rumik:
// Authorization: Bearer against silk-api.rumik.ai; Murf: api-key against
// global.api.murf.ai) and from vendor docs, not guessed.
//
// Runs only from server actions, never during a call.

export type ValidationResult = {
  /** "valid" only after a real 2xx from the vendor. */
  status: "valid" | "invalid" | "unverified" | "error";
  /** Shown to the operator. Never contains the credential. */
  message: string;
};

const TIMEOUT_MS = 12_000;

type Probe = {
  url: string;
  headers: (key: string) => Record<string, string>;
};

// A cheap, read-only endpoint per provider. Deliberately nothing that
// synthesises audio or transcribes — validating a key must not cost the
// customer money.
const PROBES: Record<string, Probe> = {
  deepgram: {
    url: "https://api.deepgram.com/v1/projects",
    headers: (k) => ({ Authorization: `Token ${k}` }),
  },
  sarvam: {
    url: "https://api.sarvam.ai/v2/models",
    headers: (k) => ({ "api-subscription-key": k }),
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/user",
    headers: (k) => ({ "xi-api-key": k }),
  },
  cartesia: {
    url: "https://api.cartesia.ai/voices",
    headers: (k) => ({ "X-API-Key": k, "Cartesia-Version": "2024-06-10" }),
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  murf: {
    url: "https://global.api.murf.ai/v1/speech/voices",
    headers: (k) => ({ "api-key": k }),
  },
};

/** Gemini passes the key in the query string rather than a header. */
function geminiUrl(key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
}

/**
 * Providers we can store a credential for but cannot yet prove works, because
 * no cheap read-only validation endpoint has been confirmed for them. Being
 * explicit here is the point: the operator sees "stored, not verified" instead
 * of a green tick this code cannot justify.
 */
const NO_CONFIRMED_PROBE: Record<string, string> = {
  rumik:
    "Key stored. Rumik has no confirmed read-only validation endpoint, so it " +
    "has not been tested against the vendor — the first call will prove it.",
};

export async function validateProviderCredential(
  provider: string,
  credential: string,
): Promise<ValidationResult> {
  const pid = (provider || "").trim().toLowerCase();
  const key = (credential || "").trim();
  if (!key) return { status: "invalid", message: "No credential was provided." };

  // Google Cloud STT/TTS use a service-account JSON blob. Proving it works
  // needs a signed JWT exchange, which is more than a key check should do, so
  // validate the shape and say plainly that it is unverified.
  if (pid === "google") {
    try {
      const j = JSON.parse(key);
      const missing = ["type", "project_id", "private_key", "client_email"].filter(
        (f) => !j[f],
      );
      if (missing.length) {
        return {
          status: "invalid",
          message: `Service-account JSON is missing: ${missing.join(", ")}.`,
        };
      }
      if (j.type !== "service_account") {
        return { status: "invalid", message: `Expected type "service_account", got "${j.type}".` };
      }
      return {
        status: "unverified",
        message:
          `Service-account JSON for ${j.client_email} stored. Google needs a signed ` +
          `token exchange to verify, so it has not been tested against the vendor.`,
      };
    } catch {
      return { status: "invalid", message: "Not valid JSON — paste the whole service-account file." };
    }
  }

  if (NO_CONFIRMED_PROBE[pid]) {
    return { status: "unverified", message: NO_CONFIRMED_PROBE[pid] };
  }

  const probe: Probe | undefined =
    pid === "gemini"
      ? { url: geminiUrl(key), headers: () => ({}) }
      : PROBES[pid];

  if (!probe) {
    return {
      status: "unverified",
      message: `Key stored. No validation endpoint is configured for ${pid}, so it has not been tested.`,
    };
  }

  try {
    const res = await fetch(probe.url, {
      method: "GET",
      headers: probe.headers(key),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      return { status: "valid", message: `Verified against the ${pid} API (HTTP ${res.status}).` };
    }
    if (res.status === 401 || res.status === 403) {
      return { status: "invalid", message: `${pid} rejected this credential (HTTP ${res.status}).` };
    }
    if (res.status === 402) {
      return {
        status: "invalid",
        message: `${pid} accepted the key but the account cannot pay (HTTP 402).`,
      };
    }
    if (res.status === 429) {
      return {
        status: "unverified",
        message: `${pid} rate-limited the check (HTTP 429). The key may still be fine.`,
      };
    }
    return { status: "error", message: `${pid} returned HTTP ${res.status}.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A network failure says nothing about the key, so do not call it invalid.
    return { status: "unverified", message: `Could not reach ${pid}: ${msg.slice(0, 120)}` };
  }
}
