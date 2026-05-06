import type { Assistant } from "@prisma/client";

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
    <span className="block text-xs uppercase tracking-wide text-gray-400 mb-1">
      {label}
    </span>
    {children}
  </label>
);

const inputCls =
  "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40";

export default function AssistantForm({ action, initial }: Props) {
  return (
    <form action={action} className="space-y-4 max-w-2xl">
      <Field label="Name">
        <input
          name="name"
          required
          defaultValue={initial?.name}
          className={inputCls}
        />
      </Field>
      <Field label="First message (greeting)">
        <input
          name="firstMessage"
          defaultValue={initial?.firstMessage ?? ""}
          className={inputCls}
        />
      </Field>
      <Field label="System prompt">
        <textarea
          name="systemPrompt"
          rows={10}
          defaultValue={initial?.systemPrompt ?? ""}
          className={inputCls + " font-mono"}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="LLM provider">
          <select
            name="llmProvider"
            defaultValue={initial?.llmProvider ?? "OPENAI"}
            className={inputCls}
          >
            {["OPENAI", "GROQ", "OPENROUTER", "ANTHROPIC", "CUSTOM"].map(
              (v) => (
                <option key={v}>{v}</option>
              )
            )}
          </select>
        </Field>
        <Field label="LLM model">
          <input
            name="llmModel"
            defaultValue={initial?.llmModel ?? "gpt-4o-mini"}
            className={inputCls}
          />
        </Field>
        <Field label="TTS provider">
          <select
            name="ttsProvider"
            defaultValue={initial?.ttsProvider ?? "DEEPGRAM"}
            className={inputCls}
          >
            {["OPENAI", "DEEPGRAM", "SARVAM", "CARTESIA", "ELEVENLABS"].map(
              (v) => (
                <option key={v}>{v}</option>
              )
            )}
          </select>
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
          <select
            name="sttProvider"
            defaultValue={initial?.sttProvider ?? "DEEPGRAM"}
            className={inputCls}
          >
            {["DEEPGRAM", "OPENAI", "SARVAM"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
      <button className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:opacity-90">
        Save
      </button>
    </form>
  );
}
