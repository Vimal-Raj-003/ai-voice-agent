import type { Assistant } from "@prisma/client";
import Select from "./Select";

type Props = {
  action: (formData: FormData) => Promise<void>;
  initial?: Partial<Assistant>;
};

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
      {label}
    </span>
    {children}
    {hint && (
      <span className="block text-[10px] text-gray-500 mt-1">{hint}</span>
    )}
  </label>
);

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

const LLM_PROVIDERS = [
  { value: "OPENAI", label: "OpenAI" },
  { value: "GROQ", label: "Groq" },
  { value: "OPENROUTER", label: "OpenRouter" },
  { value: "ANTHROPIC", label: "Anthropic" },
  { value: "CUSTOM", label: "Custom" },
];

const TTS_PROVIDERS = [
  { value: "DEEPGRAM", label: "Deepgram" },
  { value: "OPENAI", label: "OpenAI" },
  { value: "SARVAM", label: "Sarvam" },
  { value: "CARTESIA", label: "Cartesia" },
  { value: "ELEVENLABS", label: "ElevenLabs" },
];

const STT_PROVIDERS = [
  { value: "DEEPGRAM", label: "Deepgram" },
  { value: "OPENAI", label: "OpenAI" },
  { value: "SARVAM", label: "Sarvam" },
];

const SENSITIVITY = [
  {
    value: "LOW",
    label: "Low — patient",
    description: "Wait longer before responding. Fewer interruptions.",
  },
  {
    value: "MEDIUM",
    label: "Medium — balanced",
    description: "Moderate threshold (~1s silence).",
  },
  {
    value: "HIGH",
    label: "High — snappy",
    description: "React fast (~400ms). Risk of cutting the user off.",
  },
];

const BOOL_OPTIONS = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
];

export default function AssistantForm({ action, initial }: Props) {
  return (
    <form action={action} className="space-y-5 max-w-2xl">
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
        <Field label="System prompt">
          <textarea
            name="systemPrompt"
            rows={10}
            defaultValue={initial?.systemPrompt ?? ""}
            placeholder="You are Priya, a friendly receptionist who…"
            className={inputCls + " font-mono resize-y"}
          />
        </Field>
      </section>

      {/* ── Stack ── */}
      <section className="glass rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Voice stack
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="LLM provider">
            <Select
              name="llmProvider"
              options={LLM_PROVIDERS}
              defaultValue={initial?.llmProvider ?? "OPENAI"}
            />
          </Field>
          <Field label="LLM model">
            <input
              name="llmModel"
              defaultValue={initial?.llmModel ?? "gpt-4o-mini"}
              className={inputCls}
            />
          </Field>
          <Field label="TTS provider">
            <Select
              name="ttsProvider"
              options={TTS_PROVIDERS}
              defaultValue={initial?.ttsProvider ?? "DEEPGRAM"}
            />
          </Field>
          <Field label="Voice ID">
            <input
              name="voiceId"
              defaultValue={initial?.voiceId ?? ""}
              className={inputCls}
              placeholder="e.g. alloy, aura-athena-en"
            />
          </Field>
          <Field label="STT provider">
            <Select
              name="sttProvider"
              options={STT_PROVIDERS}
              defaultValue={initial?.sttProvider ?? "DEEPGRAM"}
            />
          </Field>
        </div>
      </section>

      {/* ── Call accuracy & speech tuning ── */}
      <section className="glass rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
            Call accuracy &amp; speech
          </h3>
          <p className="text-[11px] text-gray-500 mt-1">
            Industry-standard knobs for telephony AI. Defaults work for most
            outbound flows; tune higher sensitivity for fast pitches, lower
            for elderly customer-support lines.
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
            <Select
              name="backgroundDenoising"
              options={BOOL_OPTIONS}
              defaultValue={(initial?.backgroundDenoising ?? true) ? "true" : "false"}
            />
          </Field>
          <Field
            label="Voicemail detection"
            hint="Detect answering-machine tone & leave a short message."
          >
            <Select
              name="voicemailDetection"
              options={BOOL_OPTIONS}
              defaultValue={(initial?.voicemailDetection ?? false) ? "true" : "false"}
            />
          </Field>
          <Field
            label="Hallucination guard"
            hint='Auto-append "do not invent information" to the system prompt.'
          >
            <Select
              name="hallucinationGuard"
              options={BOOL_OPTIONS}
              defaultValue={(initial?.hallucinationGuard ?? true) ? "true" : "false"}
            />
          </Field>
          <Field
            label="Recording"
            hint="Save call audio to your storage backend."
          >
            <Select
              name="recordingEnabled"
              options={BOOL_OPTIONS}
              defaultValue={(initial?.recordingEnabled ?? true) ? "true" : "false"}
            />
          </Field>
        </div>
      </section>

      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-5 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save assistant
      </button>
    </form>
  );
}
