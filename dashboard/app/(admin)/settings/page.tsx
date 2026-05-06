import { prisma } from "@/lib/prisma";
import { upsertSetting, deleteSetting } from "./actions";

export default async function SettingsPage() {
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-3xl font-bold">Settings</h1>
      <form
        action={upsertSetting}
        className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3"
      >
        <input
          name="key"
          placeholder="KEY"
          required
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono"
        />
        <input
          name="value"
          placeholder="value"
          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm font-mono"
        />
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" name="sensitive" /> sensitive (mask in display)
        </label>
        <button className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium">
          Save
        </button>
      </form>
      <ul className="rounded-2xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {rows.length === 0 && (
          <li className="p-4 text-gray-500 text-sm">No settings yet.</li>
        )}
        {rows.map((s) => (
          <li key={s.key} className="p-3 flex items-center justify-between text-sm">
            <div>
              <div className="font-mono">{s.key}</div>
              <div className="text-xs text-gray-500 font-mono break-all">
                {s.isSensitive
                  ? "•".repeat(Math.min(20, s.value.length))
                  : s.value}
              </div>
            </div>
            <form action={deleteSetting.bind(null, s.key)}>
              <button className="text-xs text-red-400 hover:text-red-300">
                delete
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
