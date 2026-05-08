import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { createPhoneNumber } from "../actions";
import PhoneNumberForm from "@/components/PhoneNumberForm";

export const dynamic = "force-dynamic";

export default async function NewPhoneNumberPage() {
  const { id: orgId } = await getDefaultOrg();
  const assistants = await prisma.assistant.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">New phone number</h1>
        <p className="text-sm text-gray-400 mt-1">
          Add an inbound number and (optionally) bind it to an assistant.
        </p>
      </div>
      <PhoneNumberForm action={createPhoneNumber} assistants={assistants} />
    </div>
  );
}
