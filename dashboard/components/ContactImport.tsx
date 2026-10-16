"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, Download, Loader2, Check, AlertCircle, X } from "lucide-react";
import {
  importContactsMapped,
  type MappedRow,
  type SmartImportResult,
} from "@/app/(admin)/contacts/actions";
import { normalizePhone } from "@/lib/phone";

// Target fields the importer can fill, with header synonyms (normalized).
type Field = "name" | "phone" | "email" | "company" | "notes" | "tags";
const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "name", label: "Name", required: true },
  { key: "phone", label: "Phone number", required: true },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
  { key: "notes", label: "Notes" },
  { key: "tags", label: "Tags" },
];
const SYNONYMS: Record<Field, string[]> = {
  name: ["name", "full_name", "fullname", "customer_name", "contact_name", "person", "first_name"],
  phone: ["phone", "phone_number", "mobile", "mobile_number", "contact_number", "number", "msisdn", "whatsapp", "cell"],
  email: ["email", "email_address", "mail", "e_mail", "emailid", "email_id"],
  company: ["company", "company_name", "organization", "organisation", "org", "business"],
  notes: ["notes", "note", "remarks", "comment", "comments", "description"],
  tags: ["tags", "tag", "labels", "label", "segments", "groups"],
};

const normalize = (h: string) =>
  h.trim().toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^\w]/g, "");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === ",") { cur.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; cur.push(field); rows.push(cur); cur = []; field = ""; continue; }
    field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function autoMap(headers: string[]): Record<Field, number> {
  const norm = headers.map(normalize);
  const out = { name: -1, phone: -1, email: -1, company: -1, notes: -1, tags: -1 } as Record<Field, number>;
  (Object.keys(SYNONYMS) as Field[]).forEach((f) => {
    out[f] = norm.findIndex((h) => SYNONYMS[f].includes(h));
  });
  return out;
}

export default function ContactImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<Field, number>>({ name: -1, phone: -1, email: -1, company: -1, notes: -1, tags: -1 });
  const [result, setResult] = useState<SmartImportResult | null>(null);

  const reset = () => { setOpen(false); setHeaders([]); setRows([]); setResult(null); setFileName(""); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const text = (await f.text()).replace(/^﻿/, "");
    const parsed = parseCsv(text);
    if (parsed.length < 2) { alert("CSV needs a header row and at least one data row."); return; }
    const hdr = parsed[0].map((h) => h.trim());
    setHeaders(hdr);
    setRows(parsed.slice(1));
    setMapping(autoMap(hdr));
    setResult(null);
    setOpen(true);
  };

  const col = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? "").trim() : "");

  const doImport = () => {
    const payload: MappedRow[] = rows.map((r) => ({
      name: col(r, mapping.name), phone: col(r, mapping.phone), email: col(r, mapping.email),
      company: col(r, mapping.company), notes: col(r, mapping.notes), tags: col(r, mapping.tags),
    }));
    start(async () => setResult(await importContactsMapped(payload)));
  };

  const canImport = mapping.name >= 0 && mapping.phone >= 0;
  const sample = rows.slice(0, 5);

  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
      >
        <Upload size={15} /> Import CSV
      </button>
      <a
        href="/api/contacts/export"
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
      >
        <Download size={14} /> Export
      </a>
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d0f1a] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Import contacts</h2>
              <button onClick={reset} className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white"><X size={18} /></button>
            </div>
            <p className="mt-1 text-xs text-gray-500">{fileName} · {rows.length} row{rows.length === 1 ? "" : "s"} detected</p>

            {!result ? (
              <>
                {/* mapping */}
                <div className="mt-4 space-y-2">
                  <div className="text-[11px] uppercase tracking-widest text-gray-400">Column mapping</div>
                  {FIELDS.map((f) => (
                    <div key={f.key} className="flex items-center gap-3">
                      <label className="w-32 shrink-0 text-sm text-gray-300">
                        {f.label}{f.required && <span className="text-red-400"> *</span>}
                      </label>
                      <span className="text-gray-600">→</span>
                      <select
                        value={mapping[f.key]}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                        className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      >
                        <option value={-1}>— none —</option>
                        {headers.map((h, i) => (<option key={i} value={i}>{h}</option>))}
                      </select>
                    </div>
                  ))}
                  {!canImport && (
                    <p className="text-[11px] text-amber-300">Map both Name and Phone number to continue.</p>
                  )}
                </div>

                {/* preview */}
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-widest text-gray-400">Preview (first {sample.length})</div>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/[0.04] text-[11px] uppercase text-gray-400">
                        <tr><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Phone</th><th className="px-3 py-1.5">Email</th></tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {sample.map((r, i) => {
                          const n = normalizePhone(col(r, mapping.phone));
                          return (
                            <tr key={i}>
                              <td className="px-3 py-1.5">{col(r, mapping.name) || <span className="text-gray-600">—</span>}</td>
                              <td className="px-3 py-1.5 font-mono text-xs">
                                {n.e164 ? (
                                  <>
                                    {n.e164}
                                    {n.assumedIndia && <span className="ml-1 font-sans text-[10px] text-amber-300">(India assumed)</span>}
                                  </>
                                ) : (
                                  <span className="text-red-300">{col(r, mapping.phone) || "—"}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-gray-400">{col(r, mapping.email) || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={reset} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5">Cancel</button>
                  <button
                    onClick={doImport}
                    disabled={!canImport || pending}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {pending && <Loader2 size={14} className="animate-spin" />}
                    {pending ? "Importing…" : `Import ${rows.length} contact${rows.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            ) : (
              /* result */
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Check size={16} className="text-emerald-400" />
                  <span><b className="text-emerald-300">{result.imported}</b> imported · <b className="text-amber-300">{result.duplicates}</b> skipped duplicates · <b className="text-red-300">{result.invalid.length}</b> invalid{result.assumedIndia > 0 && <> · <b className="text-sky-300">{result.assumedIndia}</b> India-assumed</>}</span>
                </div>
                {result.invalid.length > 0 && (
                  <details open className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-red-300"><AlertCircle size={13} /> {result.invalid.length} invalid row{result.invalid.length === 1 ? "" : "s"}</summary>
                    <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-[11px] font-mono text-red-200/80">
                      {result.invalid.map((v, i) => (
                        <li key={i}>row {v.row}: {v.name || "(no name)"} {v.phone && `[${v.phone}]`} — {v.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="flex justify-end">
                  <button onClick={reset} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15">Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
