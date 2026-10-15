"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import ProviderBadges from "./ProviderBadges";
import HumanTransferFields, { type TransferTarget } from "./HumanTransferFields";
import ProviderStatusChip from "./ProviderStatusChip";
import { useProviderRegistry, selectableProviders, findProvider } from "@/lib/useProviderRegistry";
import type { Assistant } from "@prisma/client";
import { saveAssistant } from "@/app/(admin)/assistants/actions";
import type { AssistantActionState } from "@/app/(admin)/assistants/actions";
import Select from "./Select";
import BooleanSelect from "./BooleanSelect";
import FormField from "./FormField";
import SystemPromptField from "./SystemPromptField";
import LlmStackFields from "./LlmStackFields";
import TtsStackFields from "./TtsStackFields";

type ToolOption = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

type Props = {
  // "edit" when an existing assistant id is present, "create" otherwise. When
  // omitted it's inferred from initial.id so the button + mode stay correct.
  mode?: "create" | "edit";
  initial?: Partial<Assistant>;
  tools?: ToolOption[];
  selectedToolIds?: string[];
  /** Human call forwarding destinations for this assistant. */
  transferTargets?: TransferTarget[];
};

// Adapter for legacy `hint` prop usage in this file — every existing call
// site uses `hint`, FormField uses `tooltip`. Map them so we can do the
// conversion in one place.
const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <FormField label={label} tooltip={hint}>
    {children}
  </FormField>
);

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

const SENSITIVITY = [
  {
    value: "LOW",
    label: "Low — patient",
    description: "2.0s silence required before agent speaks. Fewest interruptions.",
  },
  {
    value: "MEDIUM",
    label: "Medium — balanced",
    description: "1.0s silence threshold. Best for most outbound flows.",
  },
  {
    value: "HIGH",
    label: "High — snappy",
    description: "0.4s silence. Risk of cutting the user off mid-thought.",
  },
];

export default function AssistantForm({
  mode,
  initial,
  tools = [],
  selectedToolIds = [],
  transferTargets = [],
}: Props) {
  const selectedSet = new Set(selectedToolIds);
  // Edit mode when an id is present (or explicitly passed). Drives the button
  // label and makes create-vs-edit unambiguous in the UI.
  const isEdit = mode ? mode === "edit" : Boolean(initial?.id);
  // useActionState tracks the pending transition so we can disable the submit
  // button — this is what stops a double-click from inserting a second row.
  const [state, formAction, pending] = useActionState<AssistantActionState, FormData>(
    saveAssistant,
    {},
  );
  return (
    // Wider max-width so the 2-column row (Identity + Call accuracy) has
    // enough horizontal room for the Identity textarea + the call-accuracy
    // 2-col internal grid. Falls back to a single column under lg.
    <form action={formAction} className="space-y-5 max-w-5xl">
      {/* Mode selector for the single saveAssistant action: present id → update
          that row; empty → create. Kept in sync with the record being edited. */}
      <input type="hidden" name="assistantId" defaultValue={initial?.id ?? ""} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Identity ── */}
        <section className="glass rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Identity
          </h3>
          <Field label="Name">
            <input
              name="name"
              required
              defaultValue={initial?.name}
              placeholder="My Assistant"
              className={inputCls}
            />
          </Field>
          <Field label="First message (greeting)">
            <input
              name="firstMessage"
              defaultValue={initial?.firstMessage ?? ""}
              placeholder="Hi! Thanks for calling Acme Dental, this is Priya. How can I help?"
              className={inputCls}
            />
          </Field>
          <SystemPromptField
            defaultValue={initial?.systemPrompt ?? ""}
            rows={14}
          />
          <FormField
            label="Recording consent message"
            tooltip="Played after the greeting when recording is enabled. Required for two-party-consent jurisdictions (most US states, India). Leave empty to skip."
          >
            <textarea
              name="recordingConsentMessage"
              rows={2}
              defaultValue={initial?.recordingConsentMessage ?? ""}
              placeholder="This call may be recorded for quality and training purposes."
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
            />
          </FormField>
          <FormField
            label="Redact PII in transcripts"
            tooltip="Auto-mask credit cards (Luhn-checked), Aadhaar, SSN, email, and phone numbers in the stored transcript."
          >
            <BooleanSelect name="redactionEnabled" defaultValue={initial?.redactionEnabled ?? true} />
          </FormField>
        </section>

        {/* ── Call accuracy (right column) — definition stays below; we move
              the JSX out of its own section into a dedicated render below
              so layout stays a single 2-col row. */}
        <CallAccuracySection initial={initial} />
      </div>

      {/* ── Voice stack ── full-width row */}
      <section className="glass rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Voice stack
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LLM provider + model are coupled: the model dropdown lists only
              models the selected provider can serve, resets on provider
              change, and blocks invalid pairs. See LlmStackFields. */}
          <LlmStackFields
            initialProvider={initial?.llmProvider ?? "OPENAI"}
            initialModel={initial?.llmModel ?? "gpt-4o-mini"}
            initialFallbackModel={initial?.llmFallbackModel ?? ""}
          />
          {/* TTS provider + voice are coupled: the voice dropdown lists only
              voices the selected provider can speak, resets on provider
              change, and blocks invalid pairs. See TtsStackFields. */}
          <TtsStackFields
            initialProvider={initial?.ttsProvider ?? "DEEPGRAM"}
            initialVoice={initial?.voiceId ?? ""}
          />
          <SttProviderField initial={initial?.sttProvider ?? "DEEPGRAM"} />
        </div>
      </section>


      <HumanTransferFields targets={transferTargets} />

      {tools.length > 0 && (
        <section className="glass rounded-2xl p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
              Tools enabled
            </h3>
            <p className="text-[11px] text-gray-500 mt-1">
              Custom HTTP tools the LLM can call mid-conversation. Define new
              ones at <code className="text-gray-400">/tools</code>.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {tools.map((t) => {
              const checked = selectedSet.has(t.id);
              return (
                <label
                  key={t.id}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                    checked
                      ? "border-violet-400/50 bg-violet-500/[0.06]"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                  } ${t.isActive ? "" : "opacity-50"}`}
                >
                  <input
                    type="checkbox"
                    name={`tool_${t.id}`}
                    defaultChecked={checked}
                    disabled={!t.isActive}
                    className="mt-0.5 accent-violet-400"
                  />
                  <span>
                    <span className="block font-mono text-xs text-violet-200">
                      {t.name}
                      {!t.isActive && (
                        <span className="ml-2 text-gray-500">(paused)</span>
                      )}
                    </span>
                    {t.description && (
                      <span className="block text-[11px] text-gray-500 line-clamp-2">
                        {t.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {state?.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-200"
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        onClick={() => console.log("[assistant.save] button_clicked", { isEdit })}
        className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-5 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? isEdit
            ? "Saving changes…"
            : "Creating…"
          : isEdit
            ? "Save changes"
            : "Create assistant"}
      </button>
    </form>
  );
}

// Right-column component on the new 2-col layout. Uses its own internal
// 2-col grid for the 10 knobs so they wrap nicely under lg.
function CallAccuracySection({ initial }: { initial?: Partial<Assistant> }) {
  return (
    <section className="glass rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Call accuracy &amp; speech
        </h3>
        <p className="text-[11px] text-gray-500 mt-1">
          Industry-standard knobs for telephony AI. Defaults work for most
          outbound flows; tune higher sensitivity for fast pitches, lower for
          elderly customer-support lines.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="End-of-speech sensitivity"
          hint="How aggressively VAD declares the user has stopped speaking."
        >
          <Select
            name="endOfSpeechSensitivity"
            options={SENSITIVITY}
            defaultValue={initial?.endOfSpeechSensitivity ?? "LOW"}
          />
        </Field>
        <Field
          label="Interruption threshold (ms)"
          hint="Min. continuous user speech to interrupt the agent. 100–250 typical."
        >
          <input
            type="number"
            name="interruptionThresholdMs"
            min={50}
            max={2000}
            defaultValue={initial?.interruptionThresholdMs ?? 150}
            className={inputCls}
          />
        </Field>
        <Field
          label="Min pause before agent responds (ms)"
          hint="Floor to prevent trampling the customer. Industry default ~200."
        >
          <input
            type="number"
            name="minPauseMs"
            min={0}
            max={3000}
            defaultValue={initial?.minPauseMs ?? 200}
            className={inputCls}
          />
        </Field>
        <Field
          label="STT confidence threshold (%)"
          hint="Below this, agent asks the user to repeat. 0 = never. ~55 typical."
        >
          <input
            type="number"
            name="confidenceThresholdPct"
            min={0}
            max={100}
            defaultValue={initial?.confidenceThresholdPct ?? 0}
            className={inputCls}
          />
        </Field>
        <Field
          label="Silence timeout (s)"
          hint="End the call after this much continuous silence."
        >
          <input
            type="number"
            name="silenceTimeoutSeconds"
            min={5}
            max={300}
            defaultValue={initial?.silenceTimeoutSeconds ?? 30}
            className={inputCls}
          />
        </Field>
        <Field
          label="Max call duration (s)"
          hint="Hard cap. 1800 = 30 minutes."
        >
          <input
            type="number"
            name="maxDurationSeconds"
            min={60}
            max={7200}
            defaultValue={initial?.maxDurationSeconds ?? 1800}
            className={inputCls}
          />
        </Field>
        <Field
          label="Background denoising"
          hint="LiveKit BVCTelephony noise cancellation."
        >
          <BooleanSelect
            name="backgroundDenoising"
            defaultValue={initial?.backgroundDenoising ?? true}
          />
        </Field>
        <Field
          label="Voicemail detection"
          hint="Detect answering-machine tone, optionally leave a message, then hang up."
        >
          <BooleanSelect
            name="voicemailDetection"
            defaultValue={initial?.voicemailDetection ?? false}
          />
        </Field>
        <Field
          label="Hallucination guard"
          hint='Auto-append "do not invent information" to the system prompt.'
        >
          <BooleanSelect
            name="hallucinationGuard"
            defaultValue={initial?.hallucinationGuard ?? true}
          />
        </Field>
        <Field
          label="Recording"
          hint="Save call audio to your storage backend."
        >
          <BooleanSelect
            name="recordingEnabled"
            defaultValue={initial?.recordingEnabled ?? true}
          />
        </Field>
      </div>
      <Field
        label="Voicemail message (optional)"
        hint="Spoken when voicemail is detected. Leave blank to hang up silently."
      >
        <textarea
          name="voicemailMessage"
          rows={3}
          defaultValue={initial?.voicemailMessage ?? ""}
          placeholder="Hi, this is Priya from Acme Dental — please call us back at +91…"
          className={inputCls}
        />
      </Field>
    </section>
  );
}

/** STT provider, driven by the central registry — no local provider list. */
function SttProviderField({ initial }: { initial: string }) {
  const { providers, stale, loading } = useProviderRegistry("STT");
  const [provider, setProvider] = useState((initial || "DEEPGRAM").toUpperCase());
  const usable = selectableProviders(providers);
  const current = findProvider(providers, provider);
  const notIntegrated = providers.filter((p) => !p.integrated);

  const options = usable.map((p) => ({
    value: p.value,
    label: p.name,
    description: [p.badges.map((b) => b.label).join(" · "), p.priceLabel]
      .filter(Boolean).join("  ·  ") || undefined,
  }));

  return (
    <Field label="STT provider">
      <Select
        name="sttProvider"
        options={options.length ? options : [{ value: provider, label: provider }]}
        defaultValue={provider}
        onChange={(v) => setProvider(v.toUpperCase())}
      />
      {current && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* Recommendation badges: how good/affordable this provider is. */}
          <ProviderBadges registryBadges={current.badges} />
          {/* Connection status, kept as its own chip (never inside the row above). */}
          <ProviderStatusChip status={current.statusBadge} />
        </div>
      )}
      {current?.priceLabel && <p className="mt-1 text-[11px] text-gray-500">{current.priceLabel}</p>}
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
      {/* A provider that cannot stream is segmented locally by VAD, so replies
          start only after the caller pauses. Worth saying before they pick it. */}
      {current?.canRunCalls && current?.needs_vad && (
        <p className="mt-1 text-[11px] text-gray-500">
          {current.name} has no streaming API — transcripts arrive only after the
          caller pauses, so replies start a little later.
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
    </Field>
  );
}
