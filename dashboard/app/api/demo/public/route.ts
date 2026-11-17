import { voiceService } from "@/lib/voice-service";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;

const MAX_DEMO_SESSIONS = 5;
const MAX_DEMO_CALL_SECONDS = 240; // Strict 4-minute maximum per demo call

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

function parseQuotaFromNotes(notes: string | null | undefined): { access: number; calls: number } {
  if (!notes) return { access: 0, calls: 0 };
  const accessMatch = notes.match(/\[DEMO_ACCESS:(\d+)\]/);
  const callsMatch = notes.match(/\[DEMO_CALLS:(\d+)\]/);
  return {
    access: accessMatch ? parseInt(accessMatch[1], 10) || 0 : 0,
    calls: callsMatch ? parseInt(callsMatch[1], 10) || 0 : 0,
  };
}

function buildUpdatedNotes(
  existingNotes: string | null | undefined,
  access: number,
  calls: number,
  metaLine: string
): string {
  const stripped = (existingNotes || "")
    .replace(/\[DEMO_ACCESS:\d+\]\s*/g, "")
    .replace(/\[DEMO_CALLS:\d+\]\s*/g, "")
    .trim();
  const base = metaLine || stripped;
  return `[DEMO_ACCESS:${access}] [DEMO_CALLS:${calls}] ${base}`.trim();
}

function normalizePhone10(raw: unknown): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

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
        isActive: true,
        metadata: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const formatted = assistants.map((a) => {
      const meta = (a.metadata as Record<string, unknown>) || {};
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        role: (meta.roleKey as string) || "support",
        active: a.isActive,
      };
    });

    return Response.json(
      {
        assistants: formatted,
        maxSessions: MAX_DEMO_SESSIONS,
        maxCallSeconds: MAX_DEMO_CALL_SECONDS,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    const msg = excMsg(err);
    console.error("Public demo assistants error:", msg);
    return Response.json({ error: msg }, { status: 500, headers: CORS_HEADERS });
  }
}

function excMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

    const cleanEmail = normalizeEmail(lead?.email);
    const digits10 = normalizePhone10(lead?.phone);

    if (!cleanEmail || !cleanEmail.includes("@") || digits10.length !== 10) {
      return Response.json(
        { error: "Please provide a valid email address and 10-digit mobile number to access the live demo." },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const canonicalPhone = `+91 ${digits10}`;

    let assistant: { id: string; name: string } | null = null;
    if (assistantId) {
      assistant = await prisma.assistant.findFirst({
        where: { id: assistantId, organizationId: org.id, isActive: true },
        select: { id: true, name: true },
      });
      if (!assistant) {
        return Response.json(
          { error: "Assistant not found or inactive." },
          { status: 404, headers: CORS_HEADERS }
        );
      }
    }

    // Look up all contacts matching EITHER this email OR this 10-digit phone number
    const matchingContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { email: { equals: cleanEmail, mode: "insensitive" } },
          { phoneNumber: { contains: digits10 } },
        ],
      },
      select: { id: true, phoneNumber: true, email: true, notes: true },
    });

    let maxAccessUsed = 0;
    let maxCallsUsed = 0;
    for (const c of matchingContacts) {
      const q = parseQuotaFromNotes(c.notes);
      if (q.access > maxAccessUsed) maxAccessUsed = q.access;
      if (q.calls > maxCallsUsed) maxCallsUsed = q.calls;
    }

    const metaSummary = [
      lead?.businessType ? `Industry: ${lead.businessType}` : "",
      lead?.country ? `Country: ${lead.country}` : "Country: India",
      lead?.state ? `State: ${lead.state}` : "",
      lead?.city ? `City: ${lead.city}` : "",
      lead?.description ? `Note: ${lead.description}` : "",
      assistant ? `Last Demo: ${assistant.name}` : "Demo Portal Access",
    ]
      .filter(Boolean)
      .join(" | ");

    // Case A: Lead Form Submission (entering the Demo Page)
    if (!assistant) {
      if (maxAccessUsed >= MAX_DEMO_SESSIONS || maxCallsUsed >= MAX_DEMO_SESSIONS) {
        return Response.json(
          {
            error: `Demo limit reached (${MAX_DEMO_SESSIONS}/${MAX_DEMO_SESSIONS} sessions used for ${cleanEmail}). Contact vims20.vs@gmail.com for full enterprise access.`,
            limitReached: true,
            usedSessions: MAX_DEMO_SESSIONS,
            remainingSessions: 0,
            maxSessions: MAX_DEMO_SESSIONS,
          },
          { status: 403, headers: CORS_HEADERS }
        );
      }

      const nextAccess = maxAccessUsed + 1;
      const updatedNotes = buildUpdatedNotes(
        matchingContacts[0]?.notes,
        nextAccess,
        maxCallsUsed,
        metaSummary
      );

      // Persist incremented quota across any existing matching contacts + upsert canonical phone
      if (matchingContacts.length > 0) {
        await Promise.all(
          matchingContacts.map((c) =>
            prisma.contact.update({
              where: { id: c.id },
              data: {
                name: lead?.fullName?.trim() || undefined,
                email: cleanEmail,
                company: lead?.businessName?.trim() || undefined,
                notes: buildUpdatedNotes(c.notes, nextAccess, maxCallsUsed, metaSummary),
              },
            })
          )
        );
      } else {
        await prisma.contact.upsert({
          where: { phoneNumber: canonicalPhone },
          update: {
            name: lead?.fullName?.trim() || undefined,
            email: cleanEmail,
            company: lead?.businessName?.trim() || undefined,
            notes: updatedNotes,
          },
          create: {
            phoneNumber: canonicalPhone,
            name: lead?.fullName?.trim() || null,
            email: cleanEmail,
            company: lead?.businessName?.trim() || null,
            notes: updatedNotes,
          },
        });
      }

      return Response.json(
        {
          success: true,
          leadSaved: true,
          usedSessions: nextAccess,
          remainingSessions: Math.max(0, MAX_DEMO_SESSIONS - Math.max(nextAccess, maxCallsUsed)),
          maxSessions: MAX_DEMO_SESSIONS,
          maxCallSeconds: MAX_DEMO_CALL_SECONDS,
        },
        { headers: CORS_HEADERS }
      );
    }

    // Case B: Starting a Live Voice Call with one of the 9 Assistants
    if (maxCallsUsed >= MAX_DEMO_SESSIONS || maxAccessUsed > MAX_DEMO_SESSIONS) {
      return Response.json(
        {
          error: `Demo call limit reached (${MAX_DEMO_SESSIONS}/${MAX_DEMO_SESSIONS} sessions used for ${cleanEmail}). Contact vims20.vs@gmail.com for full enterprise access.`,
          limitReached: true,
          usedSessions: MAX_DEMO_SESSIONS,
          remainingSessions: 0,
          maxSessions: MAX_DEMO_SESSIONS,
        },
        { status: 403, headers: CORS_HEADERS }
      );
    }

    const nextCalls = maxCallsUsed + 1;
    const effectiveAccess = Math.max(1, maxAccessUsed);
    const updatedCallNotes = buildUpdatedNotes(
      matchingContacts[0]?.notes,
      effectiveAccess,
      nextCalls,
      metaSummary
    );

    if (matchingContacts.length > 0) {
      await Promise.all(
        matchingContacts.map((c) =>
          prisma.contact.update({
            where: { id: c.id },
            data: {
              name: lead?.fullName?.trim() || undefined,
              email: cleanEmail,
              company: lead?.businessName?.trim() || undefined,
              notes: buildUpdatedNotes(c.notes, effectiveAccess, nextCalls, metaSummary),
            },
          })
        )
      );
    } else {
      await prisma.contact.upsert({
        where: { phoneNumber: canonicalPhone },
        update: {
          email: cleanEmail,
          notes: updatedCallNotes,
        },
        create: {
          phoneNumber: canonicalPhone,
          name: lead?.fullName?.trim() || null,
          email: cleanEmail,
          company: lead?.businessName?.trim() || null,
          notes: updatedCallNotes,
        },
      });
    }

    const leadContext = {
      fullName: typeof lead?.fullName === "string" ? lead.fullName.trim() : undefined,
      phone: canonicalPhone,
      email: cleanEmail,
      businessName: typeof lead?.businessName === "string" ? lead.businessName.trim() : undefined,
      businessType: typeof lead?.businessType === "string" ? lead.businessType.trim() : undefined,
      country: "India",
      state: typeof lead?.state === "string" ? lead.state.trim() : undefined,
      city: typeof lead?.city === "string" ? lead.city.trim() : undefined,
      description: typeof lead?.description === "string" ? lead.description.trim() : undefined,
    };

    const tokenData = await voiceService.demoToken(assistant.id, org.id, leadContext);
    return Response.json(
      {
        token: tokenData.token,
        room: tokenData.room,
        url: tokenData.url,
        assistant_name: assistant.name,
        usedSessions: Math.max(effectiveAccess, nextCalls),
        remainingSessions: Math.max(0, MAX_DEMO_SESSIONS - Math.max(effectiveAccess, nextCalls)),
        maxSessions: MAX_DEMO_SESSIONS,
        maxCallSeconds: MAX_DEMO_CALL_SECONDS,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (exc) {
    const msg = excMsg(exc);
    console.error("Public demo token error:", msg);
    return Response.json({ error: msg }, { status: 502, headers: CORS_HEADERS });
  }
}
