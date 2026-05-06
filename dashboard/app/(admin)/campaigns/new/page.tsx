import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { createCampaign } from "../actions";
import CampaignForm from "@/components/CampaignForm";

export default async function NewCampaignPage() {
  const { id: orgId } = await getDefaultOrg();
  const assistants = await prisma.assistant.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">New campaign</h1>
      <CampaignForm action={createCampaign} assistants={assistants} />
    </div>
  );
}
