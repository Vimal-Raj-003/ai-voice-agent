import type { PhoneNumber } from "@prisma/client";
import Select from "./Select";
import BooleanSelect from "./BooleanSelect";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

const PROVIDERS = [
  { value: "vobiz", label: "Vobiz" },
  { value: "twilio", label: "Twilio" },
  { value: "telnyx", label: "Telnyx" },
];

export default function PhoneNumberForm({
  action,
  initial,
  assistants,
  isEdit,
}: {
  action: (fd: FormData) => Promise<void>;
  initial?: Partial<PhoneNumber>;
  assistants: { id: string; name: string }[];
  isEdit?: boolean;
}) {
  const assistantOptions = [
    { value: "", label: "— Unassigned (default profile) —" },
    ...assistants.map((a) => ({ value: a.id, label: a.name })),
  ];
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-5">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Number (E.164)
        </span>
        <input
          name="number"
          required
          defaultValue={initial?.number ?? ""}
          placeholder="+918065480036"
          readOnly={isEdit}
          className={inputCls + " font-mono"}
        />
        {isEdit && (
          <span className="block text-[10px] text-gray-500 mt-1">
            Number is the immutable identity of the row — delete and recreate
            to change it.
          </span>
        )}
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Label{" "}
          <span className="text-gray-600 normal-case tracking-normal">
            optional
          </span>
        </span>
        <input
          name="label"
          defaultValue={initial?.label ?? ""}
          placeholder="Sales line / Support line / Bangalore office"
          className={inputCls}
        />
      </label>
      <div>
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Assistant
        </span>
        <Select
          name="assistantId"
          options={assistantOptions}
          defaultValue={initial?.assistantId ?? ""}
        />
        <span className="block text-[10px] text-gray-500 mt-1">
          Inbound calls to this number use this assistant&apos;s prompt, voice,
          and tools. Leave unassigned to fall through to the default agent
          profile.
        </span>
      </div>
      <div>
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Provider
        </span>
        <Select
          name="provider"
          options={PROVIDERS}
          defaultValue={initial?.provider ?? "vobiz"}
        />
      </div>
      <div>
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Active
        </span>
        <BooleanSelect
          name="isActive"
          defaultValue={initial?.isActive ?? true}
        />
      </div>
      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save number
      </button>
    </form>
  );
}
