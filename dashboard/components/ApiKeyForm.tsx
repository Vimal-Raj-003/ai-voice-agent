"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy } from "lucide-react";
import type { CreateResult } from "@/app/(admin)/api-keys/actions";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

export default function ApiKeyForm({
  action,
}: {
  action: (fd: FormData) => Promise<CreateResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  function onSubmit(fd: FormData) {
    startTransition(async () => {
      const r = await action(fd);
      setResult(r);
    });
  }

  if (result?.ok) {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-4 text-amber-100">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong className="block mb-1">
              This is the only time we&apos;ll show this key.
            </strong>
            Save it somewhere safe — we hash it at rest and can&apos;t recover
            the plaintext later.
          </div>
        </div>
        <div className="glass rounded-2xl p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-400">
            Plaintext key
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              {result.plaintext}
            </code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(result.plaintext);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* ignore */
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs hover:bg-black/50"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="text-[11px] text-gray-500">
            Send it as <code className="text-gray-400">Authorization: Bearer …</code>{" "}
            on every voice-service API call.
          </div>
        </div>
        <Link
          href="/api-keys"
          className="inline-block text-sm text-violet-300 hover:text-violet-200"
        >
          ← Back to keys
        </Link>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="glass rounded-2xl p-5 space-y-5">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Name
        </span>
        <input
          name="name"
          required
          placeholder="n8n production · CRM webhook · Vimal&apos;s laptop"
          className={inputCls}
        />
        <span className="block text-[10px] text-gray-500 mt-1">
          For your own bookkeeping — what is this key for?
        </span>
      </label>
      {result && !result.ok && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {result.error}
        </div>
      )}
      <button
        disabled={pending}
        className="rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-4 py-2 text-sm font-semibold text-black hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 shadow-[0_0_20px_rgba(167,139,250,0.25)] transition disabled:opacity-50"
      >
        {pending ? "Issuing…" : "Issue key"}
      </button>
    </form>
  );
}
