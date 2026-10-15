"use client";

// One hook, one source. Every provider dropdown reads from this, so the UI can
// never drift from what the worker can actually build.

import { useEffect, useState } from "react";

export type RegistryBadge = { label: string; tone: "good" | "warn" | "bad" | "info"; why: string };

/**
 * Connection status, deliberately separate from the recommendation badges.
 * `badges` says whether a provider is any GOOD; this says whether it is USABLE
 * right now. Rendering them in one row previously meant a provider with no key
 * showed nothing but "Needs API Key".
 */
export type RegistryStatusBadge = RegistryBadge & {
  status: "configured" | "not_configured" | "not_integrated" | "billing_required";
};

export type RegistryProvider = {
  id: string;
  value: string;              // upper-case, matches the Prisma enum
  name: string;
  capability: "STT" | "TTS";
  integrated: boolean;
  configured: boolean;
  status: "configured" | "not_configured" | "not_integrated" | "billing_required";
  /** Whether a live call may actually run on this provider (adapter + credential). */
  canRunCalls: boolean;
  /** True when an adapter exists but nobody has supplied a key yet. */
  needsCredential: boolean;
  /** "tenant" when this organisation supplied the key, "server" for the platform key. */
  credentialSource: "tenant" | "server" | "";
  /** The provider cannot stream, so audio is segmented locally by VAD. */
  needs_vad: boolean;
  /** Emits partial transcripts mid-utterance (affects barge-in responsiveness). */
  emits_interim: boolean;
  credential_env: string;
  credential_kind: "api_key" | "service_account_json";
  models: string[];
  voices: string[];
  supported_languages: string[];
  indian_languages: string[];
  recommended_for: string;
  priceLabel: string;
  /**
   * Recommendation badges (quality / cost / capability) from the central
   * registry. Editorial advice about the provider, NOT this account's spend and
   * NOT gated on having a key — a customer needs this to decide what to buy.
   * At most 3.
   */
  badges: RegistryBadge[];
  /** Connected / Not Configured / Not Integrated / Billing Required. */
  statusBadge: RegistryStatusBadge;
  /** Recommendation badges per model id, for a model selector. */
  modelBadges: Record<string, RegistryBadge[]>;
  /** The model the provider runs by default, which `badges` describes. */
  recommendedModel: string;
  notes: string;
};

export function useProviderRegistry(capability: "STT" | "TTS") {
  const [providers, setProviders] = useState<RegistryProvider[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/providers/registry?capability=${capability}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setProviders(Array.isArray(j.providers) ? j.providers : []);
        setStale(Boolean(j.error));
      } catch {
        if (alive) setStale(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [capability]);

  return { providers, stale, loading };
}

/**
 * Every provider the registry knows about, in dropdown order.
 *
 * All of them are listed on purpose — hiding a provider because nobody has
 * entered its key yet is how customers conclude it is unsupported. Ones that
 * cannot carry a call are listed with a badge saying why, and the form refuses
 * to save them; `canRunCalls` is the gate, not visibility.
 *
 * Order: usable first, then ones only needing a key, then unintegrated —
 * so the working choices stay at the top of the list where they were before.
 */
export function selectableProviders(providers: RegistryProvider[]): RegistryProvider[] {
  const rank = (p: RegistryProvider) =>
    p.canRunCalls ? 0 : p.integrated ? 1 : 2;
  return [...providers].sort((a, b) => rank(a) - rank(b));
}

/** The ones a call can actually be placed on right now. */
export function usableProviders(providers: RegistryProvider[]): RegistryProvider[] {
  return providers.filter((p) => p.canRunCalls);
}

export function findProvider(providers: RegistryProvider[], value: string): RegistryProvider | undefined {
  return providers.find((p) => p.value === (value || "").toUpperCase());
}
