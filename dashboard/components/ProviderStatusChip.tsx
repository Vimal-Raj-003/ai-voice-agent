// The connection-status chip for a provider, rendered separately from its
// recommendation badges.
//
// Why its own component: `ProviderBadges` carries quality/cost/capability
// advice, which is editorial and shows with or without a key. This carries
// "can I use it right now". Keeping them as two elements is what lets a
// provider read "Excellent · Low Cost · Fast" *and* "Not Configured" at the
// same time, instead of the status crowding the advice out of a 3-badge row.
//
// Uses the same chip vocabulary as ProviderBadges so the page's look is
// unchanged; only the meaning is split.

import { BADGE_CLASS, type BadgeTone } from "@/lib/providerBadges";
import type { RegistryStatusBadge } from "@/lib/useProviderRegistry";

export default function ProviderStatusChip({
  status,
  className = "",
}: {
  status?: RegistryStatusBadge;
  className?: string;
}) {
  if (!status) return null;
  return (
    <span
      title={status.why}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ring-1 ${
        BADGE_CLASS[status.tone as BadgeTone]
      } ${className}`}
    >
      {status.label}
    </span>
  );
}
