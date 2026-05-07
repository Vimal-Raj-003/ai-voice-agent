// Single source of truth for the per-provider chart colors used across
// CostStackedBar / CostByProvider / any future per-provider chart. Keep
// these aligned with the badge tones in components/Badge.tsx.

export const PROVIDER_COLORS: Record<string, string> = {
  openai: "#22d3ee",
  google: "#a78bfa",
  groq: "#34d399",
  anthropic: "#f472b6",
  deepgram: "#60a5fa",
  sarvam: "#fbbf24",
  elevenlabs: "#f87171",
  cartesia: "#c084fc",
  vobiz: "#94a3b8",
};

export const FALLBACK_PROVIDER_COLOR = "#94a3b8";

export function providerColor(name: string): string {
  return PROVIDER_COLORS[name] ?? FALLBACK_PROVIDER_COLOR;
}
