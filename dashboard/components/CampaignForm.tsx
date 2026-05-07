import type { Campaign, Assistant } from "@prisma/client";
import Select from "./Select";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

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

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft", description: "Not yet active" },
  { value: "RUNNING", label: "Running", description: "Live — agent dispatches now" },
  { value: "PAUSED", label: "Paused", description: "Temporarily halted" },
  { value: "COMPLETED", label: "Completed", description: "All targets dispatched" },
  { value: "FAILED", label: "Failed", description: "Last run errored out" },
];

const SCHEDULE_OPTIONS = [
  { value: "", label: "— None —", description: "Run once when manually started" },
  { value: "ONCE", label: "Once", description: "One-off at scheduled time" },
  { value: "DAILY", label: "Daily", description: "Every day at scheduled time IST" },
  { value: "WEEKDAYS", label: "Weekdays", description: "Mon–Fri at scheduled time IST" },
];

export default function CampaignForm({
  action,
  assistants,
  initial,
}: {
  action: (fd: FormData) => Promise<void>;
  assistants: Assistant[];
  initial?: Partial<Campaign>;
}) {
  const assistantOptions = [
    { value: "", label: "— None —", description: "No specific assistant" },
    ...assistants.map((a) => ({
      value: a.id,
      label: a.name,
      description: `${a.llmProvider}/${a.llmModel}`,
    })),
  ];

  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-5 max-w-2xl">
      <Field label="Name">
        <input
          name="name"
          required
          defaultValue={initial?.name}
          placeholder="Q3 follow-up"
          className={inputCls}
        />
      </Field>
      <Field label="Assistant">
        <Select
          name="assistantId"
          options={assistantOptions}
          defaultValue={initial?.assistantId ?? ""}
        />
      </Field>
      <Field label="Prompt override">
        <textarea
          name="prompt"
          rows={4}
          defaultValue={initial?.prompt ?? ""}
          placeholder="Optional — overrides the assistant's system prompt for this campaign only."
          className={inputCls + " resize-y"}
        />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Status">
          <Select
            name="status"
            options={STATUS_OPTIONS}
            defaultValue={initial?.status ?? "DRAFT"}
          />
        </Field>
        <Field label="Schedule">
          <Select
            name="scheduleType"
            options={SCHEDULE_OPTIONS}
            defaultValue={initial?.scheduleType ?? ""}
          />
        </Field>
        <Field label="Schedule time (HH:MM IST)">
          <input
            name="scheduleTime"
            defaultValue={initial?.scheduleTime ?? ""}
            className={inputCls}
            placeholder="10:00"
          />
        </Field>
        <Field label="Call delay (seconds between dials)">
          <input
            type="number"
            min={0}
            name="callDelaySeconds"
            defaultValue={initial?.callDelaySeconds ?? 3}
            className={inputCls}
          />
        </Field>
        <Field label="Agent profile id (optional)">
          <input
            name="agentProfileId"
            defaultValue={initial?.agentProfileId ?? ""}
            placeholder="UUID of an AgentProfile row"
            className={inputCls + " font-mono text-xs"}
          />
        </Field>
      </div>
      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save campaign
      </button>
    </form>
  );
}
