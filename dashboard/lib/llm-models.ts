// LLM provider list + the LOCAL FALLBACK model lists.
//
// Models are no longer hardcoded for normal operation: the dropdown is filled
// from `GET /api/llm/models?provider=…`, which queries each provider's OWN
// models endpoint with that provider's credential (see
// voice-service/model_catalog.py). A model the vendor adds or retires appears
// or disappears with no code change here.
//
// The lists below are the degraded path ONLY — used when live discovery fails
// (no key, outage, rate limit), in which case the UI marks the list as possibly
// outdated. They are also what the server action validates against when it
// cannot reach the catalog, so a save can never be blocked by a provider
// outage.
//
// Provider is NEVER inferred from a model id. `openai/gpt-oss-20b` served by
// Groq belongs to Groq; only the selected provider decides the endpoint.

export type LlmModelOption = { value: string; label: string };

/** One model as returned by the discovery API. */
export type DiscoveredModel = {
  id: string;
  label: string;
  provider: string;
  context: number | null;
  status: string;
  recommended: boolean;
};

export type ModelCatalog = {
  provider: string;
  models: DiscoveredModel[];
  /** "live" = fetched from the provider, "fallback" = local list. */
  source: "live" | "fallback" | "none";
  stale: boolean;
  error: string;
  recommended: string;
  count: number;
  fetched_at?: number;
  cached?: boolean;
};

export const LLM_PROVIDERS: LlmModelOption[] = [
  { value: "OPENAI", label: "OpenAI" },
  { value: "GROQ", label: "Groq" },
  { value: "GEMINI", label: "Google Gemini" },
  { value: "ANTHROPIC", label: "Anthropic" },
  { value: "OPENROUTER", label: "OpenRouter" },
  { value: "CUSTOM", label: "Custom" },
];

// Degraded-path lists. First entry is that provider's recommended default and
// mirrors the worker's own default (voice-service/llm_routing.py `_specs`).
export const LLM_PROVIDER_MODELS: Record<string, LlmModelOption[]> = {
  OPENAI: [
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  ],
  GROQ: [
    { value: "qwen/qwen3.8-27b", label: "qwen/qwen3.8-27b" },
    { value: "openai/gpt-oss-20b", label: "openai/gpt-oss-20b" },
    { value: "openai/gpt-oss-120b", label: "openai/gpt-oss-120b" },
    { value: "llama-3.3-70b-versatile", label: "llama-3.3-70b-versatile" },
  ],
  GEMINI: [
    { value: "gemini-flash-latest", label: "gemini-flash-latest" },
    { value: "gemini-flash-lite-latest", label: "gemini-flash-lite-latest" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
  ],
  ANTHROPIC: [
    { value: "claude-3-5-haiku-latest", label: "claude-3-5-haiku-latest" },
    { value: "claude-3-5-sonnet-latest", label: "claude-3-5-sonnet-latest" },
  ],
  OPENROUTER: [
    { value: "openai/gpt-4o-mini", label: "openai/gpt-4o-mini" },
    { value: "meta-llama/llama-3.3-70b-instruct", label: "meta-llama/llama-3.3-70b-instruct" },
  ],
};

// CUSTOM points at an arbitrary OpenAI-compatible endpoint, so there is nothing
// to discover — its model stays a free-text string.
export const FREE_TEXT_LLM_PROVIDERS = new Set(["CUSTOM"]);

export function isFreeTextProvider(provider: string): boolean {
  return FREE_TEXT_LLM_PROVIDERS.has(provider.toUpperCase());
}

export function defaultModelForProvider(provider: string): string {
  if (isFreeTextProvider(provider)) return "";
  return LLM_PROVIDER_MODELS[provider.toUpperCase()]?.[0]?.value ?? "";
}

/**
 * Server-side guard. Live discovery is the real source of truth, so this only
 * rejects an EMPTY model — blocking a legitimately new model the vendor just
 * released (and which is therefore absent from the local list above) would be
 * worse than accepting it. The worker reports an unusable model at call time.
 */
export function isModelValidForProvider(provider: string, model: string): boolean {
  if (!model || !model.trim()) return false;
  return true;
}

/** Empty model snaps to the provider default; anything else is passed through. */
export function coerceModelForProvider(provider: string, model: string): string {
  const m = (model || "").trim();
  if (m) return m;
  return defaultModelForProvider(provider);
}
