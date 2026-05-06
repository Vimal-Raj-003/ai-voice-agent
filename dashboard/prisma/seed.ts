import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
