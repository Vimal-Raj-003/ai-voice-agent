"use client";

// BYOK provider credentials, rendered as a second section on the existing
// /api-keys page. Uses the same glass card, divider, Badge and button styling
// as the API-keys list above it — this adds a section, it does not restyle the
// page.
//
// The provider list comes from the central registry, so a provider added in
// voice-service/provider_registry.py appears here with no change to this file.
//
// A credential is write-only from the browser's point of view: it is posted
// once and never read back. The row shows a last-4 hint and the result of the
// last real vendor check.

import { useEffect, useMemo, useState, useTransition } from "react";
import { KeyRound, RefreshCw, Check, AlertTriangle, HelpCircle } from "lucide-react";
import { Badge } from "./Badge";
import Select from "./Select";
import { useProviderRegistry, type RegistryProvider } from "@/lib/useProviderRegistry";
import type {
  ProviderCredentialRow, SaveCredentialResult,
} from "@/app/(admin)/api-keys/actions";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

function statusBadge(status: string | null) {
  switch (status) {
    case "valid":
      return <Badge tone="success">verified</Badge>;
    case "invalid":
      return <Badge tone="danger">rejected</Badge>;
    case "unverified":
      return <Badge tone="warning">not verified</Badge>;
    case "error":
      return <Badge tone="warning">check failed</Badge>;
    default:
      return <Badge tone="muted">unknown</Badge>;
  }
}

export default function ProviderCredentials({
  rows,
  save,
  recheck,
  remove,
}: {
  rows: ProviderCredentialRow[];
  save: (fd: FormData) => Promise<SaveCredentialResult>;
  recheck: (provider: string) => Promise<SaveCredentialResult>;
  remove: (provider: string) => Promise<void>;
}) {
  const stt = useProviderRegistry("STT");
  const tts = useProviderRegistry("TTS");
  const [provider, setProvider] = useState("");
  const [result, setResult] = useState<SaveCredentialResult | null>(null);
  const [pending, startTransition] = useTransition();

  // One entry per credential, not per capability: Deepgram and Sarvam each do
  // STT and TTS with the same key, so asking for it twice would be wrong.
  const providers = useMemo(() => {
    const byId = new Map<string, RegistryProvider & { caps: string[] }>();
    for (const p of [...stt.providers, ...tts.providers]) {
      if (!p.integrated) continue;          // nothing to authenticate against
      const seen = byId.get(p.id);
      if (seen) { seen.caps.push(p.capability); continue; }
      byId.set(p.id, { ...p, caps: [p.capability] });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [stt.providers, tts.providers]);

  useEffect(() => {
    if (!provider && providers.length) setProvider(providers[0].id);
  }, [providers, provider]);

  const current = providers.find((p) => p.id === provider);
  const stored = new Map(rows.map((r) => [r.provider, r]));
  const isJson = current?.credential_kind === "service_account_json";

  function onSubmit(fd: FormData) {
    startTransition(async () => {
      setResult(await save(fd));
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Provider credentials</h2>
        <p className="text-sm text-gray-400 mt-1">
          Your own speech-provider keys. These are encrypted at rest and used by
          your calls instead of the platform&apos;s shared keys. A provider stays
          visible in the assistant dropdowns either way, but only runs calls once
          its key is here.
        </p>
      </div>

      {/* Existing credentials */}
      {rows.length > 0 && (
        <div className="glass rounded-2xl divide-y divide-white/5">
          {rows.map((r) => {
            const def = providers.find((p) => p.id === r.provider);
            return (
              <div key={r.provider} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{def?.name ?? r.provider}</span>
                    {statusBadge(r.lastStatus)}
                    {def && (
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">
                        {def.caps.join(" · ")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono mt-1">
                    ••••{r.hint ?? "••••"}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    {r.lastCheckedAt
                      ? `Checked ${new Date(r.lastCheckedAt).toLocaleString()}`
                      : "Never checked"}
                    {r.lastError ? ` · ${r.lastError}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <form action={async () => { await recheck(r.provider); }}>
                    <button
                      className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1"
                      title="Re-run the vendor check for this key"
                    >
                      <RefreshCw size={12} /> Recheck
                    </button>
                  </form>
                  <form action={async () => { await remove(r.provider); }}>
                    <button className="text-xs text-red-400 hover:text-red-300 px-2 py-1">
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / replace */}
      <form action={onSubmit} className="glass rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
              Provider
            </span>
            <Select
              name="provider"
              options={
                providers.length
                  ? providers.map((p) => ({
                      value: p.id,
                      label: p.name,
                      description: [
                        p.caps.join(" · "),
                        stored.has(p.id) ? "key already stored" : undefined,
                      ].filter(Boolean).join("  ·  "),
                    }))
                  : [{ value: "", label: "Loading…" }]
              }
              defaultValue={provider}
              onChange={(v) => { setProvider(v); setResult(null); }}
            />
            {current && (
              <span className="block text-[10px] text-gray-500 mt-1">
                Falls back to the platform key{" "}
                <code className="text-gray-400">{current.credential_env}</code> when unset.
              </span>
            )}
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
              {isJson ? "Service-account JSON" : "API key"}
            </span>
            {isJson ? (
              <textarea
                key="json"
                name="credential"
                required
                rows={3}
                placeholder='{"type":"service_account", …}'
                className={`${inputCls} font-mono text-xs`}
              />
            ) : (
              <input
                key="plain"
                name="credential"
                type="password"
                required
                autoComplete="off"
                placeholder="Paste the key — it is never shown again"
                className={inputCls}
              />
            )}
            <span className="block text-[10px] text-gray-500 mt-1">
              {stored.has(provider)
                ? "Saving replaces the stored key for this provider."
                : "Checked against the provider before it is saved."}
            </span>
          </label>
        </div>

        {result && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              !result.ok
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : result.status === "valid"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-100"
            }`}
          >
            {!result.ok ? (
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            ) : result.status === "valid" ? (
              <Check size={13} className="shrink-0 mt-0.5" />
            ) : (
              <HelpCircle size={13} className="shrink-0 mt-0.5" />
            )}
            <span>{result.ok ? result.message : result.error}</span>
          </div>
        )}

        <button
          disabled={pending || !provider}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition disabled:opacity-50"
        >
          <KeyRound size={14} />
          {pending ? "Checking…" : stored.has(provider) ? "Replace key" : "Save key"}
        </button>
      </form>
    </div>
  );
}
