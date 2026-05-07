import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { voiceService } from "@/lib/voice-service";
import {
  KNOWN_SETTINGS,
  SETTING_CATEGORIES,
  settingsByCategory,
  type SettingCategory,
} from "@/lib/known-settings";
import SettingRow from "@/components/SettingRow";

const KNOWN_KEYS = new Set(KNOWN_SETTINGS.map((s) => s.key));

// Best-effort: ask the running voice-service which keys are populated via env.
// The endpoint requires the bearer token (server-only) so it's safe to call
// here. If the voice-service is offline (local dev with only the dashboard
// running) we degrade gracefully — every row simply shows "no env" instead.
async function fetchEnvOrigin(): Promise<
  Map<string, { configured: boolean }>
> {
  try {
    const data = await voiceService.settings();
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const active: SettingCategory =
    (sp.tab as SettingCategory) || "credentials";

  // Pull every stored row at once and look up by key — cheaper than N queries.
  // Run the env-origin probe in parallel so a slow voice-service doesn't gate
  // the whole page render.
  const [stored, envMap] = await Promise.all([
    prisma.setting.findMany({ orderBy: { key: "asc" } }),
    fetchEnvOrigin(),
  ]);
  const storedMap = new Map(stored.map((s) => [s.key, s]));
  const voiceServiceReachable = envMap.size > 0;

  const defs = settingsByCategory(active);
  const meta = SETTING_CATEGORIES.find((c) => c.id === active);

  // Anything stored but NOT in the known registry — surface so power-users
  // who set ad-hoc keys aren't surprised when they vanish.
  const adHoc = stored.filter((s) => !KNOWN_KEYS.has(s.key));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Values stored here override the voice-service environment variables
          for the running container.
        </p>
      </div>

      <div className="flex gap-1 border-b border-white/10">
        {SETTING_CATEGORIES.map((c) => {
          const isActive = c.id === active;
          return (
            <Link
              key={c.id}
              href={`/settings?tab=${c.id}`}
              className={`px-4 py-2 text-sm border-b-2 -mb-[1px] transition ${
                isActive
                  ? "border-purple-400 text-white"
                  : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </div>

      {meta && (
        <p className="text-xs text-gray-500 -mt-2">{meta.description}</p>
      )}

      {!voiceServiceReachable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Voice-service is offline — the &quot;env&quot; column reflects
          whatever was last stored in the DB; live env-origin information is
          unavailable until the voice-service is back up.
        </div>
      )}

      <div className="space-y-3">
        {defs.map((def) => {
          const row = storedMap.get(def.key);
          const envInfo = envMap.get(def.key);
          return (
            <SettingRow
              key={def.key}
              def={def}
              storedValue={row?.value ?? null}
              configuredViaEnv={envInfo?.configured ?? false}
            />
          );
        })}
      </div>

      {adHoc.length > 0 && active === "general" && (
        <section className="space-y-2 pt-6 border-t border-white/10">
          <h2 className="text-sm uppercase tracking-wide text-gray-400">
            Ad-hoc keys
          </h2>
          <p className="text-xs text-gray-500">
            Custom keys not in the registry. Add a matching entry to{" "}
            <code className="text-[10px]">dashboard/lib/known-settings.ts</code>{" "}
            to give them a typed input.
          </p>
          <ul className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
            {adHoc.map((s) => (
              <li
                key={s.key}
                className="p-3 flex items-center justify-between text-sm"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs">{s.key}</div>
                  <div className="text-[11px] text-gray-500 font-mono break-all">
                    {s.isSensitive
                      ? "•".repeat(Math.min(20, s.value.length))
                      : s.value}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
