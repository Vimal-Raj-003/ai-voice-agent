import type { Campaign, Assistant } from "@prisma/client";

const inputCls =
  "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm";
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

export default function CampaignForm({
  action,
  assistants,
  initial,
}: {
  action: (fd: FormData) => Promise<void>;
  assistants: Assistant[];
  initial?: Partial<Campaign>;
}) {
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
      <Field label="Assistant">
        <select
          name="assistantId"
          defaultValue={initial?.assistantId ?? ""}
          className={inputCls}
        >
          <option value="">— None —</option>
          {assistants.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Prompt override">
        <textarea
          name="prompt"
          rows={4}
          defaultValue={initial?.prompt ?? ""}
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Status">
          <select
            name="status"
            defaultValue={initial?.status ?? "DRAFT"}
            className={inputCls}
          >
            {["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "FAILED"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Schedule">
          <select
            name="scheduleType"
            defaultValue={initial?.scheduleType ?? ""}
            className={inputCls}
          >
            <option value="">— None —</option>
            {["ONCE", "DAILY", "WEEKDAYS"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Schedule time (HH:MM IST)">
          <input
            name="scheduleTime"
            defaultValue={initial?.scheduleTime ?? ""}
            className={inputCls}
            placeholder="10:00"
          />
        </Field>
        <Field label="Call delay (s)">
          <input
            type="number"
            min={0}
            name="callDelaySeconds"
            defaultValue={initial?.callDelaySeconds ?? 3}
            className={inputCls}
          />
        </Field>
        <Field label="Agent profile id">
          <input
            name="agentProfileId"
            defaultValue={initial?.agentProfileId ?? ""}
            className={inputCls}
          />
        </Field>
      </div>
      <button className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">
        Save
      </button>
    </form>
  );
}
