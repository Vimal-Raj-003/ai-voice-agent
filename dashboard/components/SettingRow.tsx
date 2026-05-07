"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Check, Loader2 } from "lucide-react";
import type { SettingDef } from "@/lib/known-settings";
import { upsertSetting } from "@/app/(admin)/settings/actions";
import Select from "./Select";

type Props = {
  def: SettingDef;
  storedValue: string | null;
  configuredViaEnv: boolean;
};

export default function SettingRow({ def, storedValue, configuredViaEnv }: Props) {
  const [reveal, setReveal] = useState(false);
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [value, setValue] = useState(storedValue ?? "");

  const isPassword = def.sensitive && !reveal;
  const isBoolean = def.type === "boolean";

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("key", def.key);
    if (isBoolean) {
      fd.set("value", value === "true" ? "true" : "false");
    } else {
      fd.set("value", value);
    }
    start(async () => {
      await upsertSetting(fd);
      setSavedAt(Date.now());
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.03] transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <label htmlFor={`set-${def.key}`} className="text-sm font-medium">
              {def.label}
            </label>
            <code className="text-[10px] text-gray-500 font-mono">{def.key}</code>
            {def.sensitive && (
              <span className="text-[10px] uppercase tracking-wide text-amber-400/80">
                sensitive
              </span>
            )}
            {storedValue && (
              <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">
                stored
              </span>
            )}
            {!storedValue && configuredViaEnv && (
              <span className="text-[10px] uppercase tracking-wide text-sky-400/80">
                env
              </span>
            )}
          </div>
          {def.description && (
            <p className="mt-1 text-xs text-gray-500">{def.description}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-stretch gap-2">
        {isBoolean ? (
          <div className="flex-1">
            {/* The parent rebuilds FormData manually in onSubmit, so the
              * Select's hidden-input name doesn't matter for submit. We
              * keep a unique name per key to avoid any DOM id collisions
              * if multiple booleans appear in the same form. */}
            <Select
              name={`bool_${def.key}`}
              defaultValue={value || "false"}
              options={[
                { value: "true", label: "true" },
                { value: "false", label: "false" },
              ]}
              onChange={(v) => setValue(v)}
            />
          </div>
        ) : (
          <input
            id={`set-${def.key}`}
            type={isPassword ? "password" : "text"}
            inputMode={def.type === "url" ? "url" : "text"}
            placeholder={
              def.sensitive && configuredViaEnv && !storedValue
                ? "configured via env (override here)"
                : def.placeholder
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
          />
        )}

        {def.sensitive && !isBoolean && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 text-gray-400 hover:text-white hover:bg-white/10"
            aria-label={reveal ? "Hide value" : "Reveal value"}
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Saving
            </>
          ) : savedAt && Date.now() - savedAt < 4000 ? (
            <>
              <Check size={12} /> Saved
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </form>
  );
}
