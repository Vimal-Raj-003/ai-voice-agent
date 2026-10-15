"use client";

// Knowledge — the websites AND files this assistant answers from.
//
// Both tabs feed the SAME pipeline (extract -> chunk -> embed -> pgvector),
// so a question is answered from whichever source is most relevant.
//
// Crawling runs in the background, so the list polls while anything is still
// CRAWLING and stops once everything settles. Knowledge is per assistant: this
// panel only ever addresses `assistantId`, and the server scopes every query to
// it as well.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe, RotateCw, Trash2, Plus, Loader2, CheckCircle2, AlertTriangle, Clock,
  Upload, FileText, Image as ImageIcon, FileSpreadsheet, Link2, Eye,
} from "lucide-react";
import KnowledgeInspector from "./KnowledgeInspector";

type Source = {
  id: string;
  url: string;
  title: string | null;
  status: "PENDING" | "CRAWLING" | "READY" | "FAILED";
  type: "URL" | "PDF" | "IMAGE" | "DOCUMENT";
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  pageCount: number;
  chunkCount: number;
  lastSyncedAt: string | null;
  error: string | null;
};

const TYPE_ICON = { URL: Link2, PDF: FileText, IMAGE: ImageIcon, DOCUMENT: FileSpreadsheet } as const;

// What the UI accepts; the server validates again before anything is stored.
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.docx,.xlsx,.xlsm";

function prettySize(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  // Round UP so a small file never reads as "0 KB".
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} B`;
}

const STATUS: Record<Source["status"], { label: string; cls: string; Icon: typeof Clock }> = {
  PENDING:  { label: "Pending",  cls: "text-gray-400",    Icon: Clock },
  CRAWLING: { label: "Processing", cls: "text-cyan-300",  Icon: Loader2 },
  READY:    { label: "Ready",    cls: "text-emerald-300", Icon: CheckCircle2 },
  FAILED:   { label: "Failed",   cls: "text-red-300",     Icon: AlertTriangle },
};

// Fixed locale + UTC so server and client render the same string.
const DT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZone: "UTC",
});

export default function UrlSetup({ assistantId }: { assistantId: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"URL" | "FILE">("URL");
  const fileInput = useRef<HTMLInputElement>(null);
  // Which source's indexed data is open. Read-only; closing changes nothing.
  const [inspecting, setInspecting] = useState<Source | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/knowledge/${assistantId}`, { cache: "no-store" });
      const j = await r.json();
      setSources(Array.isArray(j.sources) ? j.sources : []);
      return (j.sources ?? []) as Source[];
    } catch {
      return [];
    }
  }, [assistantId]);

  // Poll only while something is actively crawling.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await load();
      if (!alive) return;
      if (s.some((x) => x.status === "CRAWLING" || x.status === "PENDING")) {
        timer.current = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  const add = async () => {
    const v = url.trim();
    if (!v) return;
    setBusy(true); setNotice(null);
    try {
      const r = await fetch(`/api/knowledge/${assistantId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: v }),
      });
      const j = await r.json();
      if (!r.ok) { setNotice(j.detail || j.error || "Could not add that address."); return; }
      setUrl("");
      // Reflect PENDING immediately, then let polling take over.
      await load();
      timer.current = setTimeout(async function tick() {
        const s = await load();
        if (s.some((x) => x.status === "CRAWLING" || x.status === "PENDING")) {
          timer.current = setTimeout(tick, 4000);
        }
      }, 1500);
    } finally { setBusy(false); }
  };

  const upload = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setBusy(true); setNotice(null);
    try {
      const fd = new FormData();
      // Field name must be "files" — the server reads getlist("files").
      for (const f of Array.from(list)) fd.append("files", f, f.name);
      const r = await fetch(`/api/knowledge/${assistantId}/files`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setNotice(j.detail || j.error || "Those files could not be uploaded."); return; }
      if (j.rejected?.length) {
        setNotice(j.rejected.map((x: { fileName: string; error: string }) =>
          `${x.fileName}: ${x.error}`).join(" · "));
      }
      if (fileInput.current) fileInput.current.value = "";
      await load();
      timer.current = setTimeout(async function tick() {
        const s2 = await load();
        if (s2.some((x) => x.status === "CRAWLING" || x.status === "PENDING")) {
          timer.current = setTimeout(tick, 4000);
        }
      }, 1500);
    } finally { setBusy(false); }
  };

  const sync = async (id: string) => {
    await fetch(`/api/knowledge/${assistantId}/${id}`, { method: "POST" });
    await load();
    timer.current = setTimeout(async function tick() {
      const s = await load();
      if (s.some((x) => x.status === "CRAWLING" || x.status === "PENDING")) {
        timer.current = setTimeout(tick, 4000);
      }
    }, 1500);
  };

  const remove = async (id: string) => {
    await fetch(`/api/knowledge/${assistantId}/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-1 flex items-center gap-2">
        <Globe size={15} className="text-violet-300" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">
          Knowledge
        </h2>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Add your website or upload documents, and this assistant will answer callers
        from them. If a caller asks something your sources don&apos;t cover, the
        assistant says so instead of guessing.
      </p>

      {/* Both tabs feed the same knowledge base; the tab only picks how you add. */}
      <div className="mb-3 inline-flex rounded-lg border border-white/10 bg-black/30 p-0.5">
        {([["URL", "URL", Link2], ["FILE", "Upload File", Upload]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); setNotice(null); }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
              tab === key ? "bg-violet-500/20 text-violet-200" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {tab === "FILE" ? (
        <div>
          <input
            key="knowledge-file-input"
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => void upload(e.target.files)}
            disabled={busy}
            className="block w-full cursor-pointer rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-300 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-violet-500/20 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-violet-200 disabled:opacity-50"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            PDF, images (PNG/JPG/WEBP), Word, text, Markdown, CSV and Excel. Scanned
            pages and photos are read automatically. You can select several at once.
          </p>
        </div>
      ) : (
      <div className="flex gap-2">
        <input
          key="knowledge-url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
          placeholder="https://www.yourcompany.com/"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !url.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/30 disabled:opacity-40"
        >
          <Plus size={13} /> Add URL
        </button>
      </div>
      )}
      {notice && <p className="mt-1.5 text-[11px] text-amber-300">{notice}</p>}

      <div className="mt-4 space-y-2">
        {sources.length === 0 && (
          <p className="py-6 text-center text-xs text-gray-500">
            Nothing added yet — add a website or upload a document.
          </p>
        )}
        {sources.map((s) => {
          const st = STATUS[s.status] ?? STATUS.PENDING;
          const isFile = s.type !== "URL";
          const Icon = TYPE_ICON[s.type] ?? Link2;
          const primary = isFile
            ? (s.fileName || s.title || "file")
            : (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })();
          const secondary = isFile
            ? [s.type, prettySize(s.fileSize)].filter(Boolean).join(" · ")
            : s.url;
          return (
            <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <Icon size={14} className="mt-0.5 shrink-0 text-violet-300/70" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg">{primary}</div>
                    <div className="truncate text-[11px] text-gray-500">{secondary}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {s.status === "READY" && (
                    <button
                      type="button" onClick={() => setInspecting(s)}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-200 transition hover:bg-violet-500/20"
                    >
                      <Eye size={11} /> View Indexed Data
                    </button>
                  )}
                  <button
                    type="button" onClick={() => void sync(s.id)}
                    disabled={s.status === "CRAWLING"}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-gray-300 transition hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    <RotateCw size={11} /> {isFile ? "Re-index" : "Sync Again"}
                  </button>
                  <button
                    type="button" onClick={() => void remove(s.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-500/20"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span className={`inline-flex items-center gap-1 font-medium ${st.cls}`}>
                  <st.Icon size={12} className={s.status === "CRAWLING" ? "animate-spin" : ""} />
                  {st.label}
                </span>
                {s.status === "READY" && (
                  <>
                    <span className="text-gray-400">
                      {s.pageCount}{" "}
                      {s.type === "URL" ? (s.pageCount === 1 ? "page" : "pages")
                        : s.type === "IMAGE" ? "image"
                        : s.pageCount === 1 ? "item" : "items"}{" "}
                      indexed
                    </span>
                    <span className="text-gray-500">{s.chunkCount} sections</span>
                  </>
                )}
                {s.lastSyncedAt && (
                  <span className="text-gray-500">
                    {isFile ? "Last indexed" : "Last synced"} {DT.format(new Date(s.lastSyncedAt))}
                  </span>
                )}
              </div>

              {s.error && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span>{s.error}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Read-only inspector for one source. Mounted only while open, so it
          fetches nothing until the operator asks to see the stored data. */}
      {inspecting && (
        <KnowledgeInspector
          assistantId={assistantId}
          source={{
            id: inspecting.id,
            type: inspecting.type,
            url: inspecting.url,
            title: inspecting.title,
            fileName: inspecting.fileName,
          }}
          onClose={() => setInspecting(null)}
        />
      )}
    </section>
  );
}
