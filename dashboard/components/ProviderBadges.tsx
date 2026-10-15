// Plain-English badges next to a provider or model.
//
// The measured detail (why a badge says what it says) lives in the tooltip, so
// HTTP codes and error strings never appear beside the provider name.

import { badgesFor, BADGE_CLASS, type Badge } from "@/lib/providerBadges";

export default function ProviderBadges({
  provider,
  model,
  category,
  registryBadges,
  className = "",
}: {
  provider?: string;
  model?: string | null;
  /** "stt" | "tts" — disambiguates providers that do both (Deepgram, Sarvam). */
  category?: string;
  /** Badges already derived by the central registry; preferred when present. */
  registryBadges?: { label: string; tone: string; why: string }[];
  className?: string;
}) {
  // The registry is the source of truth. The local map remains only for callers
  // that have no registry row yet (the ops cards).
  const badges: Badge[] = registryBadges?.length
    ? registryBadges.map((b) => ({ label: b.label, tone: b.tone as Badge["tone"], evidence: b.why }))
    : badgesFor(provider ?? "", model, category);
  if (!badges.length) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {badges.map((b) => (
        <span
          key={b.label}
          title={b.evidence}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ring-1 ${BADGE_CLASS[b.tone]}`}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
