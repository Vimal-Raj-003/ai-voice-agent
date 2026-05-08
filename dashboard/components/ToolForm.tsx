import type { Tool } from "@prisma/client";
import Select from "./Select";
import BooleanSelect from "./BooleanSelect";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

const METHODS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "DELETE", label: "DELETE" },
];

function headersToText(h: unknown): string {
  if (!h || typeof h !== "object") return "";
  return Object.entries(h as Record<string, unknown>)
    .map(([k, v]) => `${k}=${String(v ?? "")}`)
    .join("\n");
}

const SCHEMA_PLACEHOLDER = `{
  "type": "object",
  "properties": {
    "city": { "type": "string", "description": "City name" }
  },
  "required": ["city"]
}`;

export default function ToolForm({
  action,
  initial,
  isEdit,
}: {
  action: (fd: FormData) => Promise<void>;
  initial?: Partial<Tool>;
  isEdit?: boolean;
}) {
  const params =
    initial?.parameters && typeof initial.parameters === "object"
      ? JSON.stringify(initial.parameters, null, 2)
      : "";
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Function name
          </span>
          <input
            name="name"
            required
            defaultValue={initial?.name ?? ""}
            placeholder="lookup_weather"
            readOnly={isEdit}
            className={inputCls + " font-mono"}
          />
          <span className="block text-[10px] text-gray-500 mt-1">
            What the LLM calls. lowercase, [a-z0-9_], ≤ 32 chars.
          </span>
        </label>
        <div>
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            HTTP method
          </span>
          <Select
            name="httpMethod"
            options={METHODS}
            defaultValue={initial?.httpMethod ?? "POST"}
          />
        </div>
      </div>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Description (visible to LLM)
        </span>
        <textarea
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          placeholder="Look up the current weather for a given city."
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          URL
        </span>
        <input
          name="httpUrl"
          required
          defaultValue={initial?.httpUrl ?? ""}
          placeholder="https://api.example.com/weather/{city}"
          className={inputCls + " font-mono"}
        />
        <span className="block text-[10px] text-gray-500 mt-1">
          Use {"{argname}"} to substitute LLM-supplied arguments. Values are
          URL-quoted before substitution.
        </span>
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Headers{" "}
          <span className="text-gray-600 normal-case tracking-normal">
            optional · key=value per line
          </span>
        </span>
        <textarea
          name="httpHeaders"
          rows={3}
          defaultValue={headersToText(initial?.httpHeaders)}
          placeholder="Authorization=Bearer your-token&#10;X-Source=jjv"
          className={inputCls + " font-mono"}
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Parameters JSON Schema
        </span>
        <textarea
          name="parametersJson"
          rows={8}
          defaultValue={params}
          placeholder={SCHEMA_PLACEHOLDER}
          className={inputCls + " font-mono text-xs"}
        />
        <span className="block text-[10px] text-gray-500 mt-1">
          OpenAI-style JSON Schema for the LLM&apos;s argument shape. Empty =
          no arguments.
        </span>
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Timeout (seconds)
          </span>
          <input
            type="number"
            name="timeoutSeconds"
            min={1}
            max={30}
            defaultValue={initial?.timeoutSeconds ?? 15}
            className={inputCls}
          />
        </label>
        <div>
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Active
          </span>
          <BooleanSelect
            name="isActive"
            defaultValue={initial?.isActive ?? true}
          />
        </div>
      </div>
      <button className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition">
        Save tool
      </button>
    </form>
  );
}
