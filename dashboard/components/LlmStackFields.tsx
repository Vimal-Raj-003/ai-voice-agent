"use client";

// LLM provider + primary/fallback model, with the model lists discovered LIVE
// from the selected provider:
//   - provider is the source of truth; changing it re-fetches the model list
//   - models come from /api/llm/models?provider=… (the provider's own models
//     endpoint), so a model the vendor adds or retires needs no code change
//   - "Refresh models" re-fetches, bypassing the server-side cache
//   - results are cached per provider for this mount, so reopening the dropdown
//     does not re-hit the API
//   - when discovery fails the local fallback list is shown and clearly marked
//     "Model list may be outdated"
//   - primary AND fallback both come from the selected provider (the worker
//     only leaves it when ALLOW_CROSS_PROVIDER_FALLBACK=true)
//
// Rendered inside AssistantForm's server-action <form>; the fields emit named
// inputs (llmProvider, llmModel, llmFallbackModel) so FormData carries them.

import { useCallback, useEffect, useRef, useState } from "react";
import FormField from "./FormField";
import { badgesFor } from "@/lib/providerBadges";
import Select from "./Select";
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_MODELS,
  type DiscoveredModel,
  type ModelCatalog,
  isFreeTextProvider,
} from "@/lib/llm-models";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

function fmtContext(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M ctx`;
  if (n >= 1000) return `${Math.round(n / 1000)}K ctx`;
  return `${n} ctx`;
}

/** "gpt-4o-mini — 128K ctx · recommended" for the <option> label. */
function optionLabel(m: DiscoveredModel): string {
  const bits = [fmtContext(m.context)];
  if (m.recommended) bits.push("recommended");
  if (m.status && m.status !== "available") bits.push(m.status);
  const meta = bits.filter(Boolean).join(" · ");
  return meta ? `${m.id} — ${meta}` : m.id;
}

export default function LlmStackFields({
  initialProvider,
  initialModel,
  initialFallbackModel,
}: {
  initialProvider?: string | null;
  initialModel?: string | null;
  initialFallbackModel?: string | null;
}) {
  const provider0 = (initialProvider || "OPENAI").toUpperCase();
  const [provider, setProvider] = useState(provider0);
  const [model, setModel] = useState(initialModel || "");
  const [fallbackModel, setFallbackModel] = useState(initialFallbackModel || "");
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(false);

  // Per-provider memo for this mount so flipping between providers (or
  // reopening a dropdown) does not re-hit the API. "Refresh models" clears it.
  const cache = useRef<Map<string, ModelCatalog>>(new Map());
  const reqId = useRef(0);

  const load = useCallback(async (p: string, refresh = false) => {
    if (isFreeTextProvider(p)) { setCatalog(null); return; }
    if (!refresh) {
      const hit = cache.current.get(p);
      if (hit) { setCatalog(hit); return; }
    }
    const mine = ++reqId.current;
    setLoading(true);
    try {
      const r = await fetch(
        `/api/llm/models?provider=${encodeURIComponent(p)}${refresh ? "&refresh=1" : ""}`,
        { cache: "no-store" });
      const data = (await r.json()) as ModelCatalog;
      if (mine !== reqId.current) return;        // a newer provider won
      cache.current.set(p, data);
      setCatalog(data);
      // Keep the current selection if the provider still offers it; otherwise
      // fall to that provider's recommended default.
      const ids = new Set(data.models.map((m) => m.id));
      setModel((prev) => (prev && ids.has(prev) ? prev : data.recommended || data.models[0]?.id || ""));
      setFallbackModel((prev) => (prev && ids.has(prev) ? prev : ""));
    } catch {
      if (mine !== reqId.current) return;
      const list = LLM_PROVIDER_MODELS[p] ?? [];
      setCatalog({
        provider: p, source: "fallback", stale: true, count: list.length,
        error: "Could not reach the model discovery service",
        recommended: list[0]?.value ?? "",
        models: list.map((m, i) => ({
          id: m.value, label: m.label, provider: p, context: null,
          status: "unknown", recommended: i === 0,
        })),
      });
    } finally {
      if (mine === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(provider); }, [provider, load]);

  const onProviderChange = (next: string) => setProvider(next.toUpperCase());

  const freeText = isFreeTextProvider(provider);
  const models = catalog?.models ?? [];
  const modelOptions = models.map((m) => ({ value: m.id, label: optionLabel(m) }));
  // A model saved earlier that the provider no longer lists must stay visible,
  // otherwise saving the form would silently change it.
  const unlisted = model && !models.some((m) => m.id === model);
  if (unlisted) modelOptions.unshift({ value: model, label: `${model} — not in current list` });

  const fallbackOptions = [
    { value: "", label: "Automatic (provider default)" },
    ...models.filter((m) => m.id !== model).map((m) => ({ value: m.id, label: optionLabel(m) })),
  ];
  if (fallbackModel && !models.some((m) => m.id === fallbackModel)) {
    fallbackOptions.push({ value: fallbackModel, label: `${fallbackModel} — not in current list` });
  }

  return (
    <>
      <FormField
        label="LLM provider"
        tooltip="Which LLM backend the voice worker calls. The model list below is fetched from this provider, and the fallback model stays on this provider too."
      >
        <Select
          name="llmProvider"
          options={LLM_PROVIDERS.map((o) => ({
            ...o,
            // Same verdicts as the badges, shown inside the dropdown so the
            // choice is informed before it is made.
            description: badgesFor(o.value).map((b) => b.label).join(" · ") || undefined,
          }))}
          defaultValue={provider}
          onChange={onProviderChange}
        />
        {/* Badges removed: the same verdicts are already in each option's
            description (see the options= above). */}
      </FormField>

      <FormField
        label="LLM model"
        tooltip={
          freeText
            ? "Free-form model string passed straight to your custom endpoint."
            : "Fetched live from the provider — only models your account can currently use for text chat are listed."
        }
      >
        {freeText ? (
          <input
            name="llmModel"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Enter the exact model id"
            className={inputCls}
            autoComplete="off"
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  name="llmModel"
                  options={(modelOptions.length ? modelOptions : [{ value: "", label: "No models available" }])
                    .map((o) => ({
                      ...o,
                      description: badgesFor(provider, o.value).map((b) => b.label).join(" · ") || undefined,
                    }))}
                  defaultValue={model}
                  onChange={setModel}
                />
              </div>
              <button
                type="button"
                onClick={() => void load(provider, true)}
                disabled={loading}
                className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11px] text-gray-300 hover:bg-white/[0.08] disabled:opacity-50"
                title="Re-fetch this provider's model list"
              >
                {loading ? "Refreshing…" : "Refresh models"}
              </button>
            </div>

            {/* Badges removed: already inside each model option. */}
            <p className="mt-1 text-[11px] text-gray-500">
              {loading
                ? `Loading ${provider} models…`
                : catalog
                  ? `${catalog.count} model${catalog.count === 1 ? "" : "s"} from ${provider}` +
                    (catalog.source === "live" ? "" : " (local list)")
                  : ""}
            </p>

            {catalog?.stale && (
              <p className="mt-1 text-[11px] text-amber-300">
                Model list may be outdated{catalog.error ? ` — ${catalog.error}` : ""}
              </p>
            )}
            {unlisted && !catalog?.stale && (
              <p className="mt-1 text-[11px] text-amber-300">
                Saved model &quot;{model}&quot; is no longer offered by {provider}; it is kept
                until you pick another.
              </p>
            )}
          </>
        )}
      </FormField>

      {!freeText && (
        <FormField
          label="Fallback model"
          tooltip="Used only when the primary model fails mid-call. It stays on the SAME provider (a different model is a separate rate-limit bucket); the worker only crosses providers when ALLOW_CROSS_PROVIDER_FALLBACK=true."
        >
          <Select
            name="llmFallbackModel"
            options={fallbackOptions}
            defaultValue={fallbackModel}
            onChange={setFallbackModel}
          />
        </FormField>
      )}
    </>
  );
}
