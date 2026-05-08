import type { Assistant } from "@prisma/client";
import Select from "./Select";
import BooleanSelect from "./BooleanSelect";
import FormField from "./FormField";
import SystemPromptField from "./SystemPromptField";

type ToolOption = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

type Props = {
  action: (formData: FormData) => Promise<void>;
  initial?: Partial<Assistant>;
  tools?: ToolOption[];
  selectedToolIds?: string[];
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
  action,
  initial,
  tools = [],
  selectedToolIds = [],
}: Props) {
  const selectedSet = new Set(selectedToolIds);
  return (
    // Wider max-width so the 2-column row (Identity + Call accuracy) has
    // enough horizontal room for the Identity textarea + the call-accuracy
    // 2-col internal grid. Falls back to a single column under lg.
    <form action={action} className="space-y-5 max-w-5xl">
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

      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-5 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save assistant
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
