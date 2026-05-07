import type { Webhook, WebhookEvent } from "@prisma/client";

const ALL_EVENTS: { id: WebhookEvent; label: string; description: string }[] = [
  {
    id: "CALL_STARTED",
    label: "CALL_STARTED",
    description: "Fired the moment the agent picks up.",
  },
  {
    id: "CALL_ENDED",
    label: "CALL_ENDED",
    description: "Fired with the final outcome, transcript, and recording URL.",
  },
  {
    id: "CALL_FAILED",
    label: "CALL_FAILED",
    description: "Dial-out failed, agent crashed, or rate-limited.",
  },
  {
    id: "TRANSCRIPT_UPDATE",
    label: "TRANSCRIPT_UPDATE",
    description: "Per-turn streaming transcript message.",
  },
  {
    id: "TRANSFER_INITIATED",
    label: "TRANSFER_INITIATED",
    description: "Agent invoked transfer_to_human.",
  },
];

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

export default function WebhookForm({
  action,
  initial,
}: {
  action: (fd: FormData) => Promise<void>;
  initial?: Partial<Webhook>;
}) {
  const events = (initial?.events as WebhookEvent[] | undefined) ?? [];
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-5">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          URL
        </span>
        <input
          name="url"
          required
          type="url"
          defaultValue={initial?.url ?? ""}
          placeholder="https://hook.example.com/event"
          className={inputCls + " font-mono"}
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Signing secret
          <span className="ml-2 text-gray-600 normal-case tracking-normal">
            optional — auto-generated if blank
          </span>
        </span>
        <input
          name="secret"
          defaultValue={initial?.secret ?? ""}
          placeholder="(leave blank to generate)"
          className={inputCls + " font-mono"}
        />
      </label>
      <fieldset>
        <legend className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2">
          Events to deliver
        </legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ALL_EVENTS.map((e) => {
            const checked = events.includes(e.id);
            return (
              <label
                key={e.id}
                className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                  checked
                    ? "border-violet-400/50 bg-violet-500/[0.06]"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <input
                  type="checkbox"
                  name={`event_${e.id}`}
                  defaultChecked={checked}
                  className="mt-0.5 accent-violet-400"
                />
                <span>
                  <span className="block font-mono text-xs text-violet-200">
                    {e.label}
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    {e.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={initial?.isActive ?? true}
          className="accent-emerald-400"
        />
        Active
      </label>
      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save webhook
      </button>
    </form>
  );
}
