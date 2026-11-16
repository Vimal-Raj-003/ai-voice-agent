import { voiceService } from "@/lib/voice-service";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

// In-memory rate limiter for public demo (prevents spamming session token creation)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  entry.count += 1;
  return true;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "client-ip";

  if (!checkRateLimit(ip)) {
    return Response.json(
      { error: "Too many demo requests. Please wait a moment before trying again." },
      { status: 429, headers: CORS_HEADERS }
    );
  }

  try {
    const org = await getDefaultOrg();
    if (!org) {
      return Response.json(
        { error: "Organization not initialized." },
        { status: 503, headers: CORS_HEADERS }
      );
    }

    const body = await request.json().catch(() => ({}));
    const requestedAssistantId =
      typeof body.assistantId === "string" ? body.assistantId : undefined;

    let assistant = null;
    if (requestedAssistantId) {
      assistant = await prisma.assistant.findFirst({
        where: { id: requestedAssistantId, organizationId: org.id, isActive: true },
        select: { id: true, name: true },
      });
    }

    if (!assistant) {
      // Find the first active assistant (or sales assistant) for the organization
      assistant = await prisma.assistant.findFirst({
        where: { organizationId: org.id, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      });
    }

    if (!assistant) {
      return Response.json(
        { error: "No active voice assistant found. Please configure an assistant first." },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const demoData = await voiceService.demoToken(assistant.id, org.id);

    return Response.json(
      {
        ...demoData,
        assistant_name: assistant.name,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json(
      { error: msg },
      { status: 502, headers: CORS_HEADERS }
    );
  }
}
