import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";

export default async function Overview() {
  const { id: orgId } = await getDefaultOrg();
  const [callCount, bookedCount, assistantCount, activeCampaigns] = await Promise.all([
    prisma.call.count({ where: { organizationId: orgId } }),
    prisma.call.count({ where: { organizationId: orgId, wasBooked: true } }),
    prisma.assistant.count({ where: { organizationId: orgId } }),
    prisma.campaign.count({ where: { organizationId: orgId, status: "RUNNING" } }),
  ]);
  const stats = [
    { label: "Total calls", value: callCount },
    { label: "Bookings", value: bookedCount },
    { label: "Assistants", value: assistantCount },
    { label: "Running campaigns", value: activeCampaigns },
  ];
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</div>
            <div className="mt-2 text-3xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
