import { PrismaClient, RateKind, RateSource } from "@prisma/client";

const prisma = new PrismaClient();

// Seed rates — Nov 2026 list prices. The 3-hourly OpenRouter fetcher
// overrides LLM rows in-place; STT / TTS / TELEPHONY rows stay at these
// defaults until the admin verifies them via the dashboard.
const SEED_RATES: Array<{
  provider: string;
  sku: string;
  kind: RateKind;
  rateUsd: string;
  source: RateSource;
  notes?: string;
}> = [
  // — LLMs (USD per 1M tokens) — auto-refreshed from OpenRouter every 3 hrs.
  { provider: "openai", sku: "gpt-4o-mini", kind: "LLM_INPUT_MTOK", rateUsd: "0.15", source: "DEFAULT" },
  { provider: "openai", sku: "gpt-4o-mini", kind: "LLM_OUTPUT_MTOK", rateUsd: "0.60", source: "DEFAULT" },
  { provider: "openai", sku: "gpt-4o", kind: "LLM_INPUT_MTOK", rateUsd: "2.50", source: "DEFAULT" },
  { provider: "openai", sku: "gpt-4o", kind: "LLM_OUTPUT_MTOK", rateUsd: "10.00", source: "DEFAULT" },
  { provider: "groq", sku: "llama-3.3-70b-versatile", kind: "LLM_INPUT_MTOK", rateUsd: "0.59", source: "DEFAULT" },
  { provider: "groq", sku: "llama-3.3-70b-versatile", kind: "LLM_OUTPUT_MTOK", rateUsd: "0.79", source: "DEFAULT" },
  { provider: "anthropic", sku: "claude-haiku-3-5", kind: "LLM_INPUT_MTOK", rateUsd: "0.80", source: "DEFAULT" },
  { provider: "anthropic", sku: "claude-haiku-3-5", kind: "LLM_OUTPUT_MTOK", rateUsd: "4.00", source: "DEFAULT" },
  { provider: "google", sku: "gemini-3.1-flash-live-preview", kind: "LLM_INPUT_MTOK", rateUsd: "2.10", source: "DEFAULT", notes: "Audio token, Live API" },
  { provider: "google", sku: "gemini-3.1-flash-live-preview", kind: "LLM_OUTPUT_MTOK", rateUsd: "8.40", source: "DEFAULT", notes: "Audio token, Live API" },

  // — STT (USD per minute) — manual refresh, no public pricing API.
  { provider: "deepgram", sku: "nova-3", kind: "STT_MINUTE", rateUsd: "0.0043", source: "DEFAULT" },
  { provider: "deepgram", sku: "nova-2", kind: "STT_MINUTE", rateUsd: "0.0043", source: "DEFAULT" },
  { provider: "sarvam", sku: "saaras-v3", kind: "STT_MINUTE", rateUsd: "0.0036", source: "DEFAULT", notes: "~₹0.30/min" },
  { provider: "openai", sku: "whisper-1", kind: "STT_MINUTE", rateUsd: "0.006", source: "DEFAULT" },

  // — TTS (USD per 1k chars) — manual refresh.
  { provider: "elevenlabs", sku: "turbo-v2-5", kind: "TTS_KCHARS", rateUsd: "0.30", source: "DEFAULT", notes: "Creator plan" },
  { provider: "cartesia", sku: "sonic-2", kind: "TTS_KCHARS", rateUsd: "0.075", source: "DEFAULT" },
  { provider: "openai", sku: "tts-1", kind: "TTS_KCHARS", rateUsd: "15.00", source: "DEFAULT", notes: "$15/1M chars" },
  { provider: "sarvam", sku: "bulbul-v3", kind: "TTS_KCHARS", rateUsd: "0.10", source: "DEFAULT" },

  // — Telephony (USD per minute) — provider rate sheet.
  { provider: "vobiz", sku: "outbound", kind: "TELEPHONY_MINUTE", rateUsd: "0.006", source: "DEFAULT", notes: "~₹0.50/min" },
  { provider: "vobiz", sku: "inbound", kind: "TELEPHONY_MINUTE", rateUsd: "0.0", source: "DEFAULT", notes: "Inbound included with trunk rental" },
];

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: { name: "Default Organization", slug: "default" },
  });
  await prisma.setting.upsert({
    where: { key: "DEFAULT_ORG_ID" },
    update: { value: org.id },
    create: { key: "DEFAULT_ORG_ID", value: org.id, isSensitive: false },
  });
  console.log("Seeded default org:", org.id);

  const existing = await prisma.agentProfile.findFirst({ where: { isDefault: true } });
  if (!existing) {
    await prisma.agentProfile.create({
      data: {
        name: "Priya — Default Booker",
        voice: "Aoede",
        model: "gemini-3.1-flash-live-preview",
        systemPrompt: null,
        enabledTools: JSON.stringify([
          "check_availability", "book_appointment", "end_call",
          "transfer_to_human", "send_sms_confirmation", "lookup_contact",
          "remember_details",
        ]),
        isDefault: true,
      },
    });
    console.log("✓ Seeded default AgentProfile");
  }

  await prisma.setting.upsert({
    where: { key: "ENVIRONMENT" },
    update: {},
    create: { key: "ENVIRONMENT", value: "development", isSensitive: false },
  });
  console.log("✓ Seeded ENVIRONMENT setting");

  let rateCount = 0;
  for (const r of SEED_RATES) {
    // Use upsert with `where` on the composite unique. Existing admin-edited
    // rows (source=MANUAL/OPENROUTER) are preserved; only DEFAULT rows or
    // missing rows get the seeded value.
    const existing = await prisma.providerRate.findUnique({
      where: { provider_sku_kind: { provider: r.provider, sku: r.sku, kind: r.kind } },
    });
    if (existing && existing.source !== "DEFAULT") continue;
    await prisma.providerRate.upsert({
      where: { provider_sku_kind: { provider: r.provider, sku: r.sku, kind: r.kind } },
      update: {
        rateUsd: r.rateUsd,
        source: r.source,
        notes: r.notes,
      },
      create: {
        provider: r.provider,
        sku: r.sku,
        kind: r.kind,
        rateUsd: r.rateUsd,
        source: r.source,
        notes: r.notes,
      },
    });
    rateCount++;
  }
  console.log(`✓ Seeded/refreshed ${rateCount} provider rate rows`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
