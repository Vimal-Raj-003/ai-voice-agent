"use client";

// TTS provider + voice, driven entirely by the central provider registry
// (voice-service/provider_registry.py, served via /api/providers/registry).
//
// There is no provider or voice list in this file. That is the point: the same
// rows the worker builds adapters from are what the dropdown shows, so the UI
// cannot offer something the backend will refuse — which is how a Gemini voice
// ("Aoede") previously ended up saved against Sarvam.
//
// Emits named inputs (ttsProvider, voiceId) so the server action still receives
// them through FormData.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import FormField from "./FormField";
import Select from "./Select";
import ProviderStatusChip from "./ProviderStatusChip";
import {
  useProviderRegistry, selectableProviders, findProvider,
  type RegistryProvider,
} from "@/lib/useProviderRegistry";

export default function TtsStackFields({
  initialProvider,
  initialVoice,
}: {
  initialProvider?: string | null;
  initialVoice?: string | null;
}) {
  const { providers, stale, loading } = useProviderRegistry("TTS");
  const [provider, setProvider] = useState((initialProvider || "SARVAM").toUpperCase());
  const [voice, setVoice] = useState(initialVoice || "");
  const [notice, setNotice] = useState<string | null>(null);

  const usable = useMemo(() => selectableProviders(providers), [providers]);
  const current: RegistryProvider | undefined = findProvider(providers, provider);

  // Once the registry arrives, correct a saved pair this provider cannot speak.
  // Runs on load as well as on change, so an assistant saved before the registry
  // existed is repaired the moment it is opened.
  useEffect(() => {
    if (!current) return;
    if (!current.voices.length) { setVoice(""); return; }
    if (!voice || !current.voices.includes(voice)) {
      const fixed = current.voices[0];
      if (voice && voice !== fixed) {
        setNotice(`"${voice}" is not a ${current.name} voice — switched to ${fixed}.`);
      }
      setVoice(fixed);
    }
    // voice is intentionally omitted: this corrects voice, it must not re-run on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const onProviderChange = (next: string) => {
    setProvider(next.toUpperCase());
    setNotice(null);
    setVoice("");          // the effect above picks this provider's default
  };

  const providerOptions = usable.map((p) => ({
    value: p.value,
    label: p.name,
    description: [p.badges.map((b) => b.label).join(" · "), p.priceLabel]
      .filter(Boolean).join("  ·  ") || undefined,
  }));
  // Providers with no adapter at all. This list is normally empty now; when it
  // is, no "not available" line is rendered, because saying that about a
  // provider the customer can actually enable would be misleading.
  const notIntegrated = providers.filter((p) => !p.integrated);

  const voiceOptions = (current?.voices ?? []).map((v) => ({ value: v, label: v }));

  return (
    <>
      <FormField
        label="TTS provider"
        tooltip="Which voice backend the worker speaks through. Only providers with a working adapter and a configured key can be selected; the voice list below always matches the provider."
      >
        <Select
          name="ttsProvider"
          options={providerOptions.length ? providerOptions : [{ value: provider, label: provider }]}
          defaultValue={provider}
          onChange={onProviderChange}
        />
        {current && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {/* Recommendation badges and the price caption were removed from
                here: both already appear inside each dropdown option's
                description, so showing them again only added height.
                The connection chip STAYS - it is operational state and is
                NOT duplicated in the options. */}
            <ProviderStatusChip status={current.statusBadge} />
          </div>
        )}
        {current?.needsCredential && (
          <p className="mt-1 text-[11px] text-amber-300">
            {current.name} needs an API key before calls can use it.{" "}
            <Link href="/api-keys" className="underline hover:text-amber-200">
              Add it on the API keys page
            </Link>
            .
          </p>
        )}
        {current?.credentialSource === "tenant" && (
          <p className="mt-1 text-[11px] text-gray-500">
            Using your organisation&apos;s own {current.name} key.
          </p>
        )}
        {notIntegrated.length > 0 && (
          <p className="mt-1 text-[11px] text-gray-500">
            Not yet available here: {notIntegrated.map((p) => p.name).join(", ")}.
          </p>
        )}
        {stale && !loading && (
          <p className="mt-1 text-[11px] text-amber-300">
            Provider list may be outdated — the voice service could not be reached.
          </p>
        )}
      </FormField>

      <FormField
        label="Voice"
        tooltip={
          current?.voices.length
            ? "Only voices this provider can actually speak are listed. Changing provider resets the voice."
            : "This provider has no selectable voice."
        }
      >
        {voiceOptions.length ? (
          <Select
            name="voiceId"
            options={voiceOptions}
            defaultValue={voice}
            onChange={(v) => { setVoice(v); setNotice(null); }}
          />
        ) : (
          <>
            <input type="hidden" name="voiceId" value="" />
            <p className="text-[11px] text-gray-500">
              {loading ? "Loading voices…" : "No selectable voice for this provider."}
            </p>
          </>
        )}
        {notice && <p className="mt-1 text-[11px] text-amber-300">{notice}</p>}
      </FormField>
    </>
  );
}
