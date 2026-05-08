import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { updatePhoneNumber, deletePhoneNumber } from "../actions";
import PhoneNumberForm from "@/components/PhoneNumberForm";
import { Badge } from "@/components/Badge";

export const dynamic = "force-dynamic";

export default async function PhoneNumberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { id: orgId } = await getDefaultOrg();
  const [p, assistants] = await Promise.all([
    prisma.phoneNumber.findUnique({
      where: { id },
      include: { assistant: { select: { id: true, name: true } } },
    }),
    prisma.assistant.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!p) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold font-mono">{p.number}</h1>
          <Badge tone={p.isActive ? "success" : "muted"}>
            {p.isActive ? "active" : "paused"}
          </Badge>
        </div>
        <p className="text-xs text-gray-500">
          Created {p.createdAt.toLocaleString()} · Updated{" "}
          {p.updatedAt.toLocaleString()}
        </p>
      </div>

      <PhoneNumberForm
        action={updatePhoneNumber.bind(null, id)}
        initial={p}
        assistants={assistants}
        isEdit
      />

      <form action={deletePhoneNumber.bind(null, id)}>
        <button className="text-xs text-red-400 hover:text-red-300">
          Delete number
        </button>
      </form>
    </div>
  );
}
