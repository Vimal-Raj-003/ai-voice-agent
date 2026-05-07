import type { Assistant } from "@prisma/client";
import Select from "./Select";

type Props = {
  action: (formData: FormData) => Promise<void>;
  initial?: Partial<Assistant>;
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
      {label}
    </span>
    {children}
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

export default function AssistantForm({ action, initial }: Props) {
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-5 max-w-2xl">
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
      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save assistant
      </button>
    </form>
  );
}
