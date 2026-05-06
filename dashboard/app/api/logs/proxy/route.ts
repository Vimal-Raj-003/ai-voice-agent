const URL_BASE = process.env.VOICE_SERVICE_URL || "http://localhost:8000";
const TOKEN = process.env.VOICE_SERVICE_TOKEN || "";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const upstream = await fetch(`${URL_BASE}/api/logs/stream${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!upstream.ok || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
