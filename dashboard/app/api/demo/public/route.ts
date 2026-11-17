import { voiceService } from "@/lib/voice-service";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

// In-memory rate limiter for public demo (prevents spamming session token creation)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;

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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET() {
  try {
    const org = await getDefaultOrg();
    const assistants = await prisma.assistant.findMany({
      where: { organizationId: org.id, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        voiceId: true,
        isActive: true,
        metadata: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const formatted = assistants.map((a) => {
      const meta = (a.metadata as Record<string, unknown>) || {};
      const vr = (meta.voiceRuntime as Record<string, unknown>) || {};
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        role: (meta.roleKey as string) || "support",
        engine: (vr.engine as string) || "gemini-live",
        model: (vr.model as string) || "gemini-3.1-flash-live-preview",
        voice: (vr.voice as string) || a.voiceId || "Zephyr",
        active: a.isActive,
      };
    });

    return Response.json({ assistants: formatted }, { headers: CORS_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Public demo assistants error:", msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "client-ip";

  if (!checkRateLimit(ip)) {
    return Response.json(
      { error: "Too many requests. Please wait a moment before trying again." },
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
    const { assistantId, lead } = body;

    // Persist lead if provided
    if (lead?.phone) {
      try {
        const cleanPhone = String(lead.phone).trim();
        const notes = [
          lead.businessType ? `Business Type: ${lead.businessType}` : "",
          lead.country ? `Country: ${lead.country}` : "",
          lead.state ? `State: ${lead.state}` : "",
          lead.city ? `City: ${lead.city}` : "",
          lead.description ? `Description: ${lead.description}` : "",
          assistantId ? `Requested Assistant: ${assistantId}` : "Pre-demo lead capture",
        ]
          .filter(Boolean)
          .join(" | ");

        await prisma.contact.upsert({
          where: { phoneNumber: cleanPhone },
          update: {
            name: lead.fullName || undefined,
            email: lead.email || undefined,
            company: lead.businessName || undefined,
            notes: notes || undefined,
          },
          create: {
            phoneNumber: cleanPhone,
            name: lead.fullName || null,
            email: lead.email || null,
            company: lead.businessName || null,
            notes: notes || null,
          },
        });
      } catch (err) {
        console.warn("Failed to persist lead contact:", err);
      }
    }

    // If caller only submitted the lead form without picking an assistant yet
    if (!assistantId) {
      return Response.json({ success: true, leadSaved: true }, { headers: CORS_HEADERS });
    }

    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, organizationId: org.id, isActive: true },
      select: { id: true, name: true },
    });

    if (!assistant) {
      return Response.json(
        { error: "Assistant not found or inactive." },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const tokenData = await voiceService.demoToken(assistantId, org.id);
    return Response.json(
      {
        ...tokenData,
        assistant_name: assistant.name,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    console.error("Public demo token error:", msg);
    return Response.json({ error: msg }, { status: 502, headers: CORS_HEADERS });
  }
}
