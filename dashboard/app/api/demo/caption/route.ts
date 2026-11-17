const VOICE_URL = process.env.VOICE_SERVICE_URL || "http://127.0.0.1:8000";
const VOICE_TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const audioWavB64 = typeof body?.audioWavB64 === "string" ? body.audioWavB64 : "";
    if (!audioWavB64 || audioWavB64.length > 4_000_000) {
      return Response.json({ text: "" });
    }

    const res = await fetch(`${VOICE_URL}/api/demo/caption`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(VOICE_TOKEN ? { Authorization: `Bearer ${VOICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ audio_wav_b64: audioWavB64 }),
      cache: "no-store",
      signal: AbortSignal.timeout(6500),
    });

    if (!res.ok) {
      return Response.json({ text: "" });
    }
    const data = await res.json().catch(() => ({ text: "" }));
    return Response.json({
      text: typeof data?.text === "string" ? data.text : "",
      language: data?.language || null,
    });
  } catch {
    return Response.json({ text: "" });
  }
}
