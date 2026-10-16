"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import HumanTransferFields, { type TransferTarget } from "./HumanTransferFields";
import ProviderStatusChip from "./ProviderStatusChip";
import { useProviderRegistry, selectableProviders, findProvider } from "@/lib/useProviderRegistry";
import type { Assistant } from "@prisma/client";
import { saveAssistant } from "@/app/(admin)/assistants/actions";
import type { AssistantActionState } from "@/app/(admin)/assistants/actions";
import Select from "./Select";
import BooleanSelect from "./BooleanSelect";
import ToggleSwitch from "./ToggleSwitch";
import { ChevronRight } from "lucide-react";
import FormField from "./FormField";
import InfoTooltip from "./InfoTooltip";
import SystemPromptField from "./SystemPromptField";
import MessageField from "./MessageField";
import UrlSetup from "./UrlSetup";
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
  /** Page heading; falls back to the assistant's own name. */
  title?: string;
  /**
   * Bound `deleteAssistant` server action. Rendered here as its own <form> in
   * the header — a SIBLING of the assistant form, never nested (nested forms
   * are invalid HTML and would break submission). Authorization and the
   * redirect stay inside the action itself.
   */
  dangerAction?: () => void | Promise<void>;
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
  title,
  dangerAction,
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
    // The page width is owned by the route-scoped AdminContainer; this form
    // lays out as independently stacked columns across whatever it is given.
    <>
      {/* Page header. Save lives here, top-right, instead of in a full-width
          footer strip — measured, that strip was 57px tall and as wide as the
          content (1276px at 1600) for a single button, and it put Delete
          another ~180px below the fold.

          The submit button sits OUTSIDE <form> and is associated with it by
          the `form` attribute, which is what lets the header hold it without
          nesting the delete form inside the assistant form (invalid HTML).
          `pending` comes from this component's own useActionState, so it works
          exactly as it did in the footer. */}
      <div
        // Page-background token, not the old footer's hardcoded #0b0d16: that
        // literal is outside the per-theme remap layer, so a sticky bar using
        // it rendered as a dark strip across a light-theme page (and made
        // Delete nearly unreadable). var(--bg-base) follows the theme and lets
        // content scroll cleanly underneath.
        style={{ background: "var(--bg-base)", borderColor: "var(--surface-border)" }}
        className="sticky top-0 z-30 -mt-2 mb-3 flex flex-wrap items-center justify-between gap-3 border-b py-2.5"
      >
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold sm:text-2xl">
          {title ?? initial?.name}
        </h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Compact danger action, separated by a rule so it never reads as
              part of the primary action pair. */}
          {dangerAction && (
            <form action={dangerAction} className="flex items-center gap-2">
              <button className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300">
                Delete assistant
              </button>
              <span aria-hidden className="h-5 w-px bg-white/10" />
            </form>
          )}
          <button
            type="submit"
            form="assistant-form"
            disabled={pending}
            aria-busy={pending}
            onClick={() => console.log("[assistant.save] button_clicked", { isEdit })}
            className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-1.5 text-sm font-semibold text-black shadow-[0_0_20px_rgba(167,139,250,0.25)] transition hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending
              ? isEdit
                ? "Saving changes…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create assistant"}
          </button>
        </div>
      </div>

      {/* Save moved to the header, so the error has to surface near it rather
          than at the bottom of the page where it would be off-screen. */}
      {state?.error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-200"
        >
          {state.error}
        </div>
      )}

      <form id="assistant-form" action={formAction} className="space-y-4">
      {/* Mode selector for the single saveAssistant action: present id → update
          that row; empty → create. Kept in sync with the record being edited. */}
      <input type="hidden" name="assistantId" defaultValue={initial?.id ?? ""} />
      {/* Independently stacked columns, NOT grid rows.
          As rows, CSS grid's default align-items:stretch made every card in a
          row grow to the height of the tallest (Identity, which holds the
          System Prompt textarea), so the shorter cards carried dead space —
          and row 2 could not begin until the tallest cell of row 1 ended,
          which is what pushed Human call forwarding far down the page.

          Now the grid's cells ARE the columns, each a flex stack. Cards keep
          their natural height (no h-full anywhere) and the next card in a
          column flows straight up after the previous one, independent of the
          other column. items-start stops the columns themselves from
          stretching to equal height. */}
      {/* TWO columns, never three: LEFT = Identity, Knowledge, Privacy;
          RIGHT = Voice stack, Call accuracy, Human forwarding. 55/45 on
          desktop (see .assistant-grid in globals.css), equal halves on
          tablet, one stacked column on mobile in exactly that card order —
          DOM order is the mobile order, so no `order-*` reshuffling is needed.

          `minmax(0, Nfr)` rather than bare `Nfr`: a bare fr track has an
          automatic minimum of min-content, so a long select or phone number
          could push a column past its share. */}
      {/* Two columns from 1280px only — the same breakpoint as the 55/45 rule.
          MEASURED at 834 with the 256px sidebar: each column was 243px, which
          truncated the LLM model to "openai…", STT to "Deepgram Nova-3 Multi…"
          and the knowledge URL input to "https://www.y". The brief keeps two
          columns only while the controls fit comfortably, so below 1280 this
          stacks instead. */}
      <div className="assistant-grid grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {/* LEFT column — Identity, Knowledge, Privacy & messages */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="glass rounded-2xl p-4 space-y-3">
            <h3 className="flex items-center text-sm font-semibold uppercase tracking-widest text-gray-300">
              Identity
              <InfoTooltip width={300}>
                Who this assistant is on a call: the name it answers to, the first line it speaks, and the system prompt it follows for the rest of the conversation.
              </InfoTooltip>
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
          </section>
          {/* Knowledge sits directly under Identity and uses the full width of
              this column. It keeps its natural height (no h-full), so Privacy
              flows straight up after it. Safe inside this <form>: no nested
              form, no named inputs, every button is type="button". */}
          {initial?.id && <UrlSetup assistantId={initial.id} />}
          {/* Privacy & messages - presentation-only grouping. Same field
              names, same defaults, same validation; only the control shape
              changed (two multi-row textareas -> one-line preview rows that
              open a dialog), so the save payload is identical. */}
          <section className="glass rounded-2xl p-3 space-y-2">
            <h3 className="flex items-center text-sm font-semibold uppercase tracking-widest text-gray-300">
              Privacy &amp; messages
              <InfoTooltip width={300}>
                Spoken notices and transcript handling: the recording-consent line, the voicemail message, and whether personal details are masked in stored transcripts.
              </InfoTooltip>
            </h3>
            <MessageField
              name="recordingConsentMessage"
              label="Consent"
              defaultValue={initial?.recordingConsentMessage ?? ""}
              placeholder="This call may be recorded for quality and training purposes."
              tooltip="Played after the greeting when recording is enabled. Required for two-party-consent jurisdictions (most US states, India). Leave empty to skip."
            />
            <MessageField
              name="voicemailMessage"
              label="Voicemail"
              defaultValue={initial?.voicemailMessage ?? ""}
              placeholder="Hi, this is Priya from Acme Dental — please call us back at +91…"
              tooltip="Spoken when voicemail is detected. Leave blank to hang up silently."
            />
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
              <span className="flex shrink-0 items-center text-[10px] uppercase tracking-widest text-gray-400">
                Redact PII
                <InfoTooltip>
                  Auto-mask credit cards (Luhn-checked), Aadhaar, SSN, email, and
                  phone numbers in the stored transcript.
                </InfoTooltip>
              </span>
              <div className="min-w-0 flex-1">
                <BooleanSelect
                  name="redactionEnabled"
                  defaultValue={initial?.redactionEnabled ?? true}
                />
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT column — Voice stack, Call accuracy & speech, Human call
            forwarding, then Tools when any are bound. */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="glass rounded-2xl p-4 space-y-3">
            <h3 className="flex items-center text-sm font-semibold uppercase tracking-widest text-gray-300">
              Voice stack
              <InfoTooltip width={300}>
                The three providers that run a call: the language model that thinks, the text-to-speech voice the caller hears, and the speech-to-text engine that transcribes them.
              </InfoTooltip>
            </h3>
            {/* MEASURED: a two-column internal layout was tried here (brief §4
                invites it) and rejected. Even at 1920, where this track is
                707px, a half-cell is ~337px and the model select rendered as
                "openai/gpt-oss-120b — not i…" with its Refresh button crushed
                beside it — exactly the truncation §4 rules out. Call accuracy
                below DOES pair cleanly, because its four knobs are short. */}
            <div className="grid grid-cols-1 gap-3">
              {/* LLM provider + model are coupled: the model dropdown lists
                  only models the selected provider can serve, resets on
                  provider change, and blocks invalid pairs. See
                  LlmStackFields. */}
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
          <CallAccuracySection initial={initial} />
          <HumanTransferFields targets={transferTargets} />
        {tools.length > 0 && (
          <section className="glass rounded-2xl p-4 space-y-2.5">
            <div>
              <h3 className="flex items-center text-sm font-semibold uppercase tracking-widest text-gray-300">
                Tools enabled
                <InfoTooltip width={300}>
                  Custom HTTP tools the LLM can call mid-conversation. Bind the
                  ones this assistant may use; the tools themselves are managed
                  outside the dashboard.
                </InfoTooltip>
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
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
        </div>
      </div>

    </form>
    </>
  );
}

// Right-column component on the new 2-col layout. Uses its own internal
// 2-col grid for the 10 knobs so they wrap nicely under lg.
function CallAccuracySection({ initial }: { initial?: Partial<Assistant> }) {
  return (
    <section className="glass rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="flex items-center text-sm font-semibold uppercase tracking-widest text-gray-300">
          Call accuracy &amp; speech
          <InfoTooltip width={310}>
            Industry-standard knobs for telephony AI. Defaults work for most
            outbound flows; tune higher sensitivity for fast pitches, lower for
            elderly customer-support lines.
          </InfoTooltip>
        </h3>
      </div>
      {/* Compact two-column field layout from 1536px (brief §5). These four
          knobs are short — a select and two number inputs — so they pair
          cleanly; below 1536 they stay stacked rather than truncate. */}
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
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
        <ToggleSwitch
          name="recordingEnabled"
          label="Recording"
          tooltip="Save call audio to your storage backend."
          defaultChecked={initial?.recordingEnabled ?? true}
        />
      </div>

      {/* Advanced knobs stay MOUNTED inside <details> rather than being
          conditionally rendered, so a collapsed field still submits its current
          value and expanding/collapsing never saves or resets anything. */}
      <details className="group rounded-xl border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400 transition hover:text-gray-200">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight size={12} className="transition group-open:rotate-90" />
            Advanced speech &amp; safety settings
            <InfoTooltip width={300}>
              Finer turn-taking and safety controls: pause handling, confidence
              floor, call duration limits, denoising, voicemail detection and the
              hallucination guard. The defaults suit most calls.
            </InfoTooltip>
          </span>
        </summary>
        <div className="grid grid-cols-1 gap-3 border-t border-white/10 p-3">
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
        <ToggleSwitch
          name="backgroundDenoising"
          label="Background denoising"
          tooltip="LiveKit BVCTelephony noise cancellation."
          defaultChecked={initial?.backgroundDenoising ?? true}
        />
        <ToggleSwitch
          name="voicemailDetection"
          label="Voicemail detection"
          tooltip="Detect answering-machine tone, optionally leave a message, then hang up."
          defaultChecked={initial?.voicemailDetection ?? false}
        />
        <ToggleSwitch
          name="hallucinationGuard"
          label="Hallucination guard"
          tooltip={'Auto-append "do not invent information" to the system prompt.'}
          defaultChecked={initial?.hallucinationGuard ?? true}
        />
        </div>
      </details>
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
