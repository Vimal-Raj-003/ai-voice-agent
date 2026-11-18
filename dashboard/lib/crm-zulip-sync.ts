/**
 * Non-blocking, isolated Twenty CRM (https://20.jilljill.in) + Zulip (https://team.jilljill.in)
 * background sync helper.
 *
 * Guarantees ZERO impact on existing application architecture:
 * - Every public function is fire-and-forget safe and swallows any network error.
 * - Strict 5-second timeouts so external latency never affects user requests.
 */

const TWENTY_URL = (process.env.TWENTY_CRM_URL || "https://20.jilljill.in").replace(/\/+$/, "");
const TWENTY_TOKEN = process.env.TWENTY_API_TOKEN || "";

const ZULIP_URL = (process.env.ZULIP_URL || "https://team.jilljill.in").replace(/\/+$/, "");
const ZULIP_BOT_EMAIL = process.env.ZULIP_BOT_EMAIL || "lead-alert-bot@team.jilljill.in";
const ZULIP_BOT_KEY = process.env.ZULIP_BOT_API_KEY || "";
const ZULIP_DIRECT_IDS = (process.env.ZULIP_DIRECT_USER_IDS || "8,10,11")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const ZULIP_STREAM = process.env.ZULIP_STREAM || "WINs";

function istNowString(): string {
  try {
    return new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return new Date().toISOString();
  }
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName || "Visitor").trim().split(/\s+/);
  const firstName = parts[0] || "Visitor";
  const lastName = parts.slice(1).join(" ") || "";
  return { firstName, lastName };
}

function cleanPhone10(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function sendZulipAlert(topic: string, markdown: string): Promise<void> {
  if (!ZULIP_BOT_KEY || !ZULIP_BOT_EMAIL) return;
  const auth = Buffer.from(`${ZULIP_BOT_EMAIL}:${ZULIP_BOT_KEY}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  // 1. Direct message to team leads (just like yesterday's Lead Alert Bot!)
  if (ZULIP_DIRECT_IDS.length > 0) {
    try {
      const dmForm = new URLSearchParams({
        type: "direct",
        to: JSON.stringify(ZULIP_DIRECT_IDS),
        content: markdown,
      });
      await fetch(`${ZULIP_URL}/api/v1/messages`, {
        method: "POST",
        headers,
        body: dmForm.toString(),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // swallow safely
    }
  }

  // 2. Also post into organized stream topic
  if (ZULIP_STREAM) {
    try {
      const streamForm = new URLSearchParams({
        type: "stream",
        to: ZULIP_STREAM,
        topic,
        content: markdown,
      });
      await fetch(`${ZULIP_URL}/api/v1/messages`, {
        method: "POST",
        headers,
        body: streamForm.toString(),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // swallow safely
    }
  }
}

async function twentyRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>
): Promise<any> {
  if (!TWENTY_TOKEN) return null;
  const res = await fetch(`${TWENTY_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TWENTY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5500),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function ensureTwentyCompany(businessName?: string): Promise<string | null> {
  const clean = (businessName || "").trim();
  if (!clean || !TWENTY_TOKEN) return null;
  try {
    const list = await twentyRequest("/rest/companies?limit=60", "GET");
    const companies: any[] = list?.data?.companies || [];
    const found = companies.find(
      (c) => String(c?.name || "").trim().toLowerCase() === clean.toLowerCase()
    );
    if (found?.id) return String(found.id);

    const created = await twentyRequest("/rest/companies", "POST", { name: clean });
    return (
      created?.data?.createCompany?.id ||
      created?.data?.company?.id ||
      created?.id ||
      null
    );
  } catch {
    return null;
  }
}

async function ensureTwentyPerson(params: {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
}): Promise<string | null> {
  if (!TWENTY_TOKEN) return null;
  try {
    const emailClean = (params.email || "").trim().toLowerCase();
    const digits10 = cleanPhone10(params.phone || "");
    const list = await twentyRequest("/rest/people?limit=100", "GET");
    const people: any[] = list?.data?.people || [];

    const existing = people.find((p) => {
      const pEmail = String(p?.emails?.primaryEmail || "").trim().toLowerCase();
      const pPhone = cleanPhone10(String(p?.phones?.primaryPhoneNumber || ""));
      return (emailClean && pEmail === emailClean) || (digits10 && pPhone === digits10);
    });
    if (existing?.id) return String(existing.id);

    const { firstName, lastName } = splitName(params.fullName);
    const payload: Record<string, unknown> = {
      name: { firstName, lastName },
    };
    if (emailClean) payload.emails = { primaryEmail: emailClean };
    if (digits10) {
      payload.phones = {
        primaryPhoneNumber: digits10,
        primaryPhoneCountryCode: "IN",
        primaryPhoneCallingCode: "+91",
      };
    }
    if (params.jobTitle) payload.jobTitle = params.jobTitle.slice(0, 80);
    if (params.companyId) payload.companyId = params.companyId;

    const created = await twentyRequest("/rest/people", "POST", payload);
    return (
      created?.data?.createPerson?.id ||
      created?.data?.person?.id ||
      created?.id ||
      null
    );
  } catch {
    return null;
  }
}

async function attachTwentyNote(params: {
  title: string;
  markdown: string;
  personId?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
}): Promise<void> {
  if (!TWENTY_TOKEN) return;
  try {
    const created = await twentyRequest("/rest/notes", "POST", {
      title: params.title.slice(0, 140),
      bodyV2: { markdown: params.markdown },
    });
    const noteId =
      created?.data?.createNote?.id || created?.data?.note?.id || created?.id || null;
    if (noteId && (params.personId || params.companyId || params.opportunityId)) {
      const targetPayload: Record<string, unknown> = { noteId };
      if (params.personId) targetPayload.targetPersonId = params.personId;
      if (params.companyId) targetPayload.targetCompanyId = params.companyId;
      if (params.opportunityId) targetPayload.targetOpportunityId = params.opportunityId;
      await twentyRequest("/rest/noteTargets", "POST", targetPayload);
    }
  } catch {
    // ignore
  }
}

export async function syncDemoLeadEvent(params: {
  eventType: "DEMO_PORTAL_OPENED" | "DEMO_CALL_STARTED";
  fullName: string;
  phone: string;
  email: string;
  businessName?: string;
  businessType?: string;
  description?: string;
  assistantName?: string;
  sessionNumber: number;
  maxSessions: number;
  roomName?: string;
}): Promise<void> {
  try {
    const when = istNowString();
    const isCallStart = params.eventType === "DEMO_CALL_STARTED";
    const zulipMd = isCallStart
      ? [
          `🎙️ **Live Demo Voice Call Started!**`,
          `- **Name:** ${params.fullName}`,
          `- **Phone:** ${params.phone}`,
          `- **Email:** ${params.email}`,
          `- **Company:** ${params.businessName || "—"} (${params.businessType || "—"})`,
          `- **Voice Agent:** ${params.assistantName || "AI Specialist"}`,
          `- **Session:** ${params.sessionNumber}/${params.maxSessions}`,
          `- **Time (IST):** ${when}`,
        ].join("\n")
      : [
          `🚀 **New Jill-Jill Demo Lead Captured!**`,
          `- **Name:** ${params.fullName}`,
          `- **Phone:** ${params.phone}`,
          `- **Email:** ${params.email}`,
          `- **Business:** ${params.businessName || "—"}`,
          `- **Industry:** ${params.businessType || "—"}`,
          params.description ? `- **Requirement:** ${params.description}` : "",
          `- **Demo Access:** ${params.sessionNumber}/${params.maxSessions}`,
          `- **Time (IST):** ${when}`,
        ]
          .filter(Boolean)
          .join("\n");

    const companyId = await ensureTwentyCompany(params.businessName);
    const personId = await ensureTwentyPerson({
      fullName: params.fullName,
      email: params.email,
      phone: params.phone,
      jobTitle: params.businessType || "Demo Lead",
      companyId,
    });

    let opportunityId: string | null = null;
    if (!isCallStart && TWENTY_TOKEN) {
      const opp = await twentyRequest("/rest/opportunities", "POST", {
        name: `${params.fullName} — ${params.businessName || "AI Voice Demo"}`,
        stage: "NEW",
        ...(companyId ? { companyId } : {}),
        ...(personId ? { pointOfContactId: personId } : {}),
      });
      opportunityId =
        opp?.data?.createOpportunity?.id || opp?.data?.opportunity?.id || null;
    }

    await Promise.all([
      attachTwentyNote({
        title: isCallStart
          ? `Live Demo Started: ${params.assistantName || "Voice Agent"}`
          : `New Demo Lead (${params.sessionNumber}/${params.maxSessions})`,
        markdown: zulipMd,
        personId,
        companyId,
        opportunityId,
      }),
      sendZulipAlert("JillJill Demo Leads", zulipMd),
    ]);
  } catch {
    // never disrupt caller flow
  }
}

export async function syncLoginAuditEvent(params: {
  email: string;
  userName?: string;
  role: "ADMIN" | "USER";
  success: boolean;
  reason?: string;
}): Promise<void> {
  try {
    const when = istNowString();
    const icon = params.success ? "🔐" : "🚨";
    const statusLabel = params.success ? "SUCCESS" : `FAILED (${params.reason || "Invalid credentials"})`;
    const md = [
      `${icon} **Jill-Jill Dashboard Login ${params.success ? "Recorded" : "Attempt Failed"}**`,
      `- **Email:** ${params.email || "unknown"}`,
      params.userName ? `- **User:** ${params.userName}` : "",
      `- **Role:** ${params.role}`,
      `- **Status:** ${statusLabel}`,
      `- **Time (IST):** ${when}`,
    ]
      .filter(Boolean)
      .join("\n");

    const personId = await ensureTwentyPerson({
      fullName: params.userName || params.email.split("@")[0] || "Dashboard User",
      email: params.email,
      jobTitle: `JillJill ${params.role}`,
    });

    await Promise.all([
      attachTwentyNote({
        title: `Login ${params.success ? "Success" : "Failed"}: ${params.email}`,
        markdown: md,
        personId,
      }),
      sendZulipAlert("JillJill Login Audit", md),
    ]);
  } catch {
    // never block login
  }
}

export async function syncAppointmentBookedEvent(params: {
  bookingId: string;
  name: string;
  phone: string;
  email?: string | null;
  date: string;
  time: string;
  service: string;
  meetingUrl?: string | null;
  source: "DASHBOARD_CALENDAR" | "VOICE_AGENT";
}): Promise<void> {
  try {
    const when = istNowString();
    const md = [
      `📅 **New Appointment Booked (${params.source === "VOICE_AGENT" ? "AI Voice Agent" : "Calendar"})!**`,
      `- **Customer:** ${params.name}`,
      `- **Phone:** ${params.phone}`,
      params.email ? `- **Email:** ${params.email}` : "",
      `- **Service:** ${params.service}`,
      `- **Slot:** ${params.date} at ${params.time} IST`,
      `- **Booking ID:** ${params.bookingId}`,
      params.meetingUrl ? `- **Video Meeting Link:** ${params.meetingUrl}` : "",
      `- **Booked At (IST):** ${when}`,
    ]
      .filter(Boolean)
      .join("\n");

    const personId = await ensureTwentyPerson({
      fullName: params.name,
      email: params.email,
      phone: params.phone,
      jobTitle: `Booked: ${params.service}`,
    });

    const opp = await twentyRequest("/rest/opportunities", "POST", {
      name: `Appointment: ${params.name} (${params.service})`,
      stage: "MEETING",
      ...(personId ? { pointOfContactId: personId } : {}),
    });
    const opportunityId =
      opp?.data?.createOpportunity?.id || opp?.data?.opportunity?.id || null;

    await Promise.all([
      attachTwentyNote({
        title: `Appointment Booked: ${params.service} (${params.date} ${params.time})`,
        markdown: md,
        personId,
        opportunityId,
      }),
      sendZulipAlert("JillJill Appointments", md),
    ]);
  } catch {
    // never block booking
  }
}
