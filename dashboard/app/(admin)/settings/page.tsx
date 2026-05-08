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
import DocsContent from "@/components/DocsContent";
import SettingsSearchBar from "@/components/SettingsSearchBar";
import { Download } from "lucide-react";

const KNOWN_KEYS = new Set(KNOWN_SETTINGS.map((s) => s.key));

// Tab id used to switch the Settings page from "settings rows" to the
// full guide / API reference. Treated as a sibling of the SettingCategory
// values but doesn't fetch any rows.
const DOCS_TAB = "docs" as const;
type TabId = SettingCategory | typeof DOCS_TAB;

// Best-effort: ask the running voice-service which keys are populated via env.
// Endpoint requires the bearer token (server-only) so it's safe here. If
// voice-service is offline we degrade gracefully — rows show "no env".
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
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const requested = sp.tab as TabId | undefined;
  const q = (sp.q ?? "").trim().toLowerCase();
  const active: TabId =
    requested === DOCS_TAB ||
    SETTING_CATEGORIES.some((c) => c.id === requested)
      ? (requested as TabId)
      : "credentials";

  const isDocs = active === DOCS_TAB;

  // Skip the Prisma fetches when the docs tab is active — rendering the
  // guide doesn't need the settings table.
  const [stored, envMap] = isDocs
    ? [[] as Awaited<ReturnType<typeof prisma.setting.findMany>>, new Map<string, { configured: boolean }>()]
    : await Promise.all([
        prisma.setting.findMany({ orderBy: { key: "asc" } }),
        fetchEnvOrigin(),
      ]);
  const storedMap = new Map(stored.map((s) => [s.key, s]));
  const voiceServiceReachable = envMap.size > 0;

  // When a search query is present, ignore the category filter and search
  // across the full registry — the user typed something specific, so the tab
  // restriction would only get in the way. Otherwise show just the active
  // category's defs.
  let defs = isDocs ? [] : settingsByCategory(active as SettingCategory);
  if (q && !isDocs) {
    defs = KNOWN_SETTINGS.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false),
    );
  }
  const meta = isDocs
    ? null
    : SETTING_CATEGORIES.find((c) => c.id === active);

  const adHoc = stored.filter((s) => !KNOWN_KEYS.has(s.key));

  // Tab list rendered in the page header. Docs always last so it visually
  // reads as the "manual" you reach for after reviewing the live config.
  const TABS: { id: TabId; label: string }[] = [
    ...SETTING_CATEGORIES.map((c) => ({ id: c.id as TabId, label: c.label })),
    { id: DOCS_TAB, label: "Docs & API" },
  ];

  return (
    // Wider container when the docs tab is active so code blocks have room.
    <div className={`space-y-6 ${isDocs ? "max-w-5xl" : "max-w-3xl"}`}>
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          {isDocs
            ? "User guide, REST API reference, environment variables, and troubleshooting — all in one place."
            : "Values stored here override the voice-service environment variables for the running container."}
        </p>
      </div>

      <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
        {TABS.map((c) => {
          const isActive = c.id === active;
          return (
            <Link
              key={c.id}
              href={`/settings?tab=${c.id}`}
              className={`px-4 py-2 text-sm border-b-2 -mb-[1px] whitespace-nowrap transition ${
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

      {meta && !isDocs && (
        <p className="text-xs text-gray-500 -mt-2">{meta.description}</p>
      )}

      {!isDocs && (
        <div className="flex flex-wrap items-center gap-3">
          <SettingsSearchBar />
          <a
            href="/api/settings/export"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:text-white hover:bg-white/10"
            title="Download all stored settings as a .env file (sensitive values redacted)"
          >
            <Download size={12} />
            Export .env
          </a>
        </div>
      )}

      {isDocs ? (
        <DocsContent />
      ) : (
        <>
          {!voiceServiceReachable && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Voice-service is offline — the &quot;env&quot; column reflects
              whatever was last stored in the DB; live env-origin information
              is unavailable until the voice-service is back up.
            </div>
          )}

          {q && defs.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-sm text-gray-500">
              No settings match <span className="font-mono">&quot;{q}&quot;</span>.
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
                <code className="text-[10px]">
                  dashboard/lib/known-settings.ts
                </code>{" "}
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
        </>
      )}
    </div>
  );
}
