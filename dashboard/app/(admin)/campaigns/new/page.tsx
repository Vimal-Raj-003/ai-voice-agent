import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { createCampaign } from "../actions";
import CampaignForm from "@/components/CampaignForm";
import BackLink from "@/components/BackLink";

export default async function NewCampaignPage() {
  const { id: orgId } = await getDefaultOrg();
  const assistants = await prisma.assistant.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-6">
      {/* Back is a real link to the list, upgraded to a history pop only when
          the referrer proves the user came from inside the app — so a direct
          URL entry or a refresh can never navigate out of the dashboard. */}
      <div className="flex items-center gap-3">
        <BackLink fallback="/campaigns" label="Campaigns" formId="campaign-form" />
      </div>
      <h1 className="text-3xl font-bold">New campaign</h1>
      <CampaignForm action={createCampaign} assistants={assistants} />
    </div>
  );
}
