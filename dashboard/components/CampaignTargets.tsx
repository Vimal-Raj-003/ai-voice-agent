"use client";

// Campaign target management: Add Number | Upload CSV | From Contacts, plus
// the target list. Replaces the permanently-visible CSV textarea.
//
// Every path goes through the same server-side classifier, so validation,
// duplicate handling and DNC treatment are identical however a number arrives.
// CSV is parsed in the browser and sent as rows - the file itself is never
// uploaded or stored.
//
// router.refresh() re-renders the server component after a write, so the list
// and the readiness panel update without a full page reload.

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Upload, Users, Search, X, Loader2, AlertTriangle, CheckCircle2, Trash2,
} from "lucide-react";
import {
  addCampaignTarget, previewCampaignTargets, importCampaignTargets,
  removeCampaignTarget, searchContactsForCampaign,
  type ImportSummary, type RawTarget, type ContactPick,
} from "@/app/(admin)/campaigns/target-actions";

export type TargetRow = {
  id: string;
  phoneNumber: string;
  leadName: string | null;
  status: string;
  attempts: number;
  callId: string | null;
  dispatchedAt: string | null;
  lastError: string | null;
};

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40";

const STATUS_TONE: Record<string, string> = {
  PENDING: "text-gray-300",
  DISPATCHED: "text-blue-400",
  COMPLETED: "text-emerald-400",
  FAILED: "text-red-400",
  BLOCKED: "text-amber-400",
  SKIPPED: "text-gray-500",
  DEFERRED: "text-gray-400",
};

type Tab = "add" | "csv" | "contacts";

export default function CampaignTargets({
  campaignId,
  targets,
  total,
  canEdit = true,
}: {
  campaignId: string;
  targets: TargetRow[];
  total: number;
  canEdit?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("add");
  const router = useRouter();

  const tabs: { id: Tab; label: string; icon: typeof Plus }[] = [
    { id: "add", label: "Add Number", icon: Plus },
    { id: "csv", label: "Upload CSV", icon: Upload },
    { id: "contacts", label: "From Contacts", icon: Users },
  ];

  return (
    <section className="glass min-w-0 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Targets
          <span className="ml-2 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-normal tracking-normal text-gray-400">
            {total}
          </span>
        </h2>
        <div role="tablist" aria-label="Add targets" className="flex flex-wrap gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
                tab === id
                  ? "border-violet-400/40 bg-violet-500/[0.14] text-violet-100"
                  : "border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        {tab === "add" && <AddNumber campaignId={campaignId} onDone={() => router.refresh()} />}
        {tab === "csv" && <UploadCsv campaignId={campaignId} onDone={() => router.refresh()} />}
        {tab === "contacts" && <FromContacts campaignId={campaignId} onDone={() => router.refresh()} />}
      </div>

      <TargetList
        campaignId={campaignId}
        targets={targets}
        canEdit={canEdit}
        onChanged={() => router.refresh()}
      />
    </section>
  );
}

// ── shared result banner ────────────────────────────────────────────────────
function Summary({ s }: { s: ImportSummary }) {
  if (!s.ok) {
    return (
      <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {s.error}
      </p>
    );
  }
  const chips = [
    { k: "Total", v: s.total, tone: "text-gray-300" },
    { k: s.dryRun ? "Ready" : "Added", v: s.dryRun ? s.valid : s.inserted, tone: "text-emerald-400" },
    { k: "Invalid", v: s.invalid, tone: "text-red-400" },
    { k: "Duplicate", v: s.duplicate, tone: "text-amber-400" },
    { k: "On DNC", v: s.dnc, tone: "text-amber-400" },
  ];
  return (
    <div className="space-y-1.5" role="status">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c.k} className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-gray-400">
            {c.k} <strong className={c.tone}>{c.v}</strong>
          </span>
        ))}
      </div>
      {s.issues.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10">
          <table className="w-full text-[11px]">
            <tbody className="divide-y divide-white/5">
              {s.issues.slice(0, 200).map((i, n) => (
                <tr key={n}>
                  <td className="w-10 px-2 py-1 text-gray-600">{i.line || "-"}</td>
                  <td className="px-2 py-1 font-mono text-gray-300">{i.value || "(empty)"}</td>
                  <td className="px-2 py-1 text-gray-500">{i.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 1. Add Number ───────────────────────────────────────────────────────────
function AddNumber({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const action = addCampaignTarget.bind(null, campaignId);
  const [state, formAction, pending] = useActionState<ImportSummary | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && state.inserted > 0) {
      formRef.current?.reset();
      onDone();
    }
    // onDone is a stable router.refresh wrapper from the parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-[160px]">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-gray-400">
            Customer name
          </span>
          <input name="leadName" placeholder="Priya Sharma" className={inputCls} />
        </label>
        <label className="min-w-0 flex-1 basis-[160px]">
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-gray-400">
            Phone number
          </span>
          <input name="phone" required inputMode="tel" placeholder="+919876543210" className={inputCls} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/[0.14] px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {pending ? "Adding…" : "Add target"}
        </button>
      </div>
      <p className="text-[10px] text-gray-500">
        A 10-digit Indian mobile is accepted and stored as +91…. Adding a number
        never starts a call.
      </p>
      {state && <Summary s={state} />}
    </form>
  );
}

// ── 2. Upload CSV ───────────────────────────────────────────────────────────
// Parsed in the browser; only the parsed rows are sent. The file is never
// uploaded or written to disk.
function parseCsv(text: string): RawTarget[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes("phone");
  let phoneCol = 0;
  let nameCol = 1;
  if (hasHeader) {
    const cols = lines[0].split(",").map((c) => c.trim().toLowerCase());
    const p = cols.findIndex((c) => c.includes("phone"));
    const n = cols.findIndex((c) => c.includes("name"));
    if (p >= 0) phoneCol = p;
    if (n >= 0) nameCol = n;
  }
  return lines.slice(hasHeader ? 1 : 0).map((line, i) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      phone: cols[phoneCol] || "",
      leadName: cols[nameCol] || null,
      line: i + 1 + (hasHeader ? 1 : 0),
    };
  });
}

function UploadCsv({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const [rows, setRows] = useState<RawTarget[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setRows(null); setFileName(""); setPreview(null); setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    setFileName(f.name);
    const parsed = parseCsv(await f.text());
    setRows(parsed);
    start(async () => setPreview(await previewCampaignTargets(campaignId, parsed)));
  };

  const confirm = () => {
    if (!rows) return;
    start(async () => {
      const r = await importCampaignTargets(campaignId, rows);
      setResult(r);
      setPreview(null);
      setRows(null);
      if (fileRef.current) fileRef.current.value = "";
      if (r.inserted > 0) onDone();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 transition hover:bg-white/[0.08] hover:text-white focus-within:ring-2 focus-within:ring-violet-500/50">
          <Upload size={12} /> Choose .csv file
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {fileName && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
            {fileName}
            <button type="button" onClick={reset} aria-label="Clear file" className="text-gray-500 hover:text-white">
              <X size={12} />
            </button>
          </span>
        )}
        {pending && <Loader2 size={13} className="animate-spin text-violet-300" />}
      </div>
      <p className="text-[10px] text-gray-500">
        Format <code className="text-gray-400">phone,lead_name</code> — header row
        optional. The file is read in your browser and never uploaded.
      </p>

      {preview && (
        <div className="space-y-2">
          <Summary s={preview} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={pending || preview.valid + preview.dnc === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/[0.14] px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 size={12} />
              Import {preview.valid} target{preview.valid === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={reset} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 transition hover:bg-white/[0.08]">
              Cancel
            </button>
            <span className="text-[10px] text-gray-500">Nothing is saved until you confirm.</span>
          </div>
        </div>
      )}
      {result && <Summary s={result} />}
    </div>
  );
}

// ── 3. From Contacts ────────────────────────────────────────────────────────
function FromContacts({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ContactPick[]>([]);
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [pending, start] = useTransition();
  // starts true for the initial listing; set from the input handler afterwards
  // so no state is assigned directly in the effect body
  const [searching, setSearching] = useState(true);

  // debounced search, including the initial (empty query) listing
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchContactsForCampaign(q);
      if (live) { setHits(r); setSearching(false); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const count = Object.keys(picked).length;
  const toggle = (c: ContactPick) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[c.phoneNumber] !== undefined) delete n[c.phoneNumber];
      else n[c.phoneNumber] = c.name;
      return n;
    });

  const add = () => {
    const rows: RawTarget[] = Object.entries(picked).map(([phone, leadName], i) => ({
      phone, leadName, line: i + 1,
    }));
    start(async () => {
      const r = await importCampaignTargets(campaignId, rows);
      setResult(r);
      setPicked({});
      if (r.inserted > 0) onDone();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={q}
            onChange={(e) => { setSearching(true); setQ(e.target.value); }}
            placeholder="Search contacts by name or number…"
            aria-label="Search contacts"
            className={inputCls + " pl-7"}
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={pending || count === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/[0.14] px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add {count || ""} selected
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10">
        {searching && hits.length === 0 && (
          <p className="px-2.5 py-3 text-[11px] text-gray-500">Searching…</p>
        )}
        {!searching && hits.length === 0 && (
          <p className="px-2.5 py-3 text-[11px] text-gray-500">
            {q ? "No contacts match that search." : "No contacts saved yet."}
          </p>
        )}
        <ul className="divide-y divide-white/5">
          {hits.map((c) => {
            const on = picked[c.phoneNumber] !== undefined;
            return (
              <li key={c.phoneNumber}>
                <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[11px] transition hover:bg-white/[0.03]">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c)}
                    className="accent-violet-400"
                    aria-label={`Select ${c.name || c.phoneNumber}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-gray-300">
                    {c.name || <span className="italic text-gray-500">Unnamed</span>}
                  </span>
                  <span className="shrink-0 font-mono text-gray-400">{c.phoneNumber}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-[10px] text-gray-500">
        Contacts are copied into this campaign — the original contact records are
        not changed. Numbers already on the campaign are skipped.
      </p>
      {result && <Summary s={result} />}
    </div>
  );
}

// ── target list ─────────────────────────────────────────────────────────────
function TargetList({
  campaignId, targets, canEdit, onChanged,
}: {
  campaignId: string; targets: TargetRow[]; canEdit: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();

  if (targets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
        No targets yet. Add a number, upload a CSV, or pick from contacts above.
      </p>
    );
  }

  const remove = (id: string) => {
    setErr(null);
    setBusy(id);
    start(async () => {
      const r = await removeCampaignTarget(campaignId, id);
      setBusy(null);
      if (!r.ok) setErr(r.error ?? "Could not remove that target.");
      else onChanged();
    });
  };

  return (
    <div className="space-y-1.5">
      {err && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err}
        </p>
      )}
      {/* Small screens: stacked rows. A table cannot shrink below its
          min-content width, which pushed the whole page into horizontal
          scroll on a phone. */}
      <ul className="space-y-1.5 sm:hidden">
        {targets.map((t) => {
          const removable = canEdit && (t.status === "PENDING" || t.status === "BLOCKED")
            && !t.callId && t.attempts === 0;
          return (
            <li key={t.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-gray-300">
                    {t.leadName || <span className="italic text-gray-600">Unnamed</span>}
                  </p>
                  <p className="break-all font-mono text-[11px] text-gray-400">{t.phoneNumber}</p>
                </div>
                {removable && (
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    disabled={busy === t.id}
                    aria-label={`Remove ${t.phoneNumber}`}
                    className="shrink-0 rounded-md p-1 text-gray-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                  >
                    {busy === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px]">
                <span className={STATUS_TONE[t.status] ?? "text-gray-400"}>{t.status}</span>
                <span className="text-gray-500">{t.attempts} attempts</span>
              </p>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-white/10 sm:block">
        <table className="w-full text-[11px] sm:min-w-[420px]">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-gray-500">
              <th className="px-2.5 py-1.5 font-medium">Name</th>
              <th className="px-2.5 py-1.5 font-medium">Number</th>
              <th className="px-2.5 py-1.5 font-medium">Status</th>
              <th className="px-2.5 py-1.5 font-medium">Attempts</th>
              <th className="px-2.5 py-1.5 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {targets.map((t) => {
              const removable = canEdit && (t.status === "PENDING" || t.status === "BLOCKED")
                && !t.callId && t.attempts === 0;
              return (
                <tr key={t.id} className="transition hover:bg-white/[0.02]">
                  <td className="max-w-[160px] truncate px-2.5 py-1.5 text-gray-300">
                    {t.leadName || <span className="italic text-gray-600">—</span>}
                  </td>
                  <td className="break-all px-2.5 py-1.5 font-mono text-gray-300">{t.phoneNumber}</td>
                  <td className={`px-2.5 py-1.5 ${STATUS_TONE[t.status] ?? "text-gray-400"}`}>
                    {t.status}
                    {t.lastError && (
                      <span className="ml-1 text-gray-600" title={t.lastError}>ⓘ</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-gray-400">{t.attempts}</td>
                  <td className="px-2.5 py-1.5 text-right">
                    {removable ? (
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        disabled={busy === t.id}
                        aria-label={`Remove ${t.phoneNumber}`}
                        className="rounded-md p-1 text-gray-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                      >
                        {busy === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-600" title="Attempted targets are kept for call history">
                        kept
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
