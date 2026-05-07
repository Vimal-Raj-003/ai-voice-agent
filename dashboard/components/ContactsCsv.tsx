"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload, Loader2, Check, AlertCircle } from "lucide-react";
import {
  importContactsCsv,
  type ImportResult,
} from "@/app/(admin)/contacts/actions";

export default function ContactsCsv() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  const onPick = () => fileRef.current?.click();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    setResult(null);
    start(async () => {
      const r = await importContactsCsv(fd);
      setResult(r);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="flex items-center gap-2">
        <a
          href="/api/contacts/export"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-gray-300 hover:bg-white/[0.06] hover:text-white transition"
        >
          <Download size={12} />
          Export CSV
        </a>
        <button
          type="button"
          onClick={onPick}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/[0.08] px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-500/[0.14] transition disabled:opacity-50"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {pending ? "Importing…" : "Import CSV"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          className="hidden"
        />
      </div>
      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            result.errors.length === 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          {result.errors.length === 0 ? (
            <Check size={14} className="shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <div>
              {result.imported} new · {result.updated} updated · {result.skipped} skipped
            </div>
            {result.errors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[10px] underline">
                  {result.errors.length} error
                  {result.errors.length === 1 ? "" : "s"} — see details
                </summary>
                <ul className="mt-1 space-y-0.5 text-[10px] font-mono text-amber-200/80">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
