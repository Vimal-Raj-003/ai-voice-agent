"use client";

// "View Indexed Data" — shows exactly what JillJill extracted and stored for
// one knowledge source, so "Ready" stops being a claim the user has to trust.
//
// Entirely READ-ONLY. Re-index and Delete stay on the source row; nothing here
// can change stored knowledge. Every request carries BOTH the assistant id and
// the source id, and the voice service scopes its queries by both, so this
// panel can never show another assistant's content.
//
// Layout contract: header and tab bar are flex siblings of the scroll area with
// `shrink-0`, so they are OUTSIDE the scrolling box and cannot scroll away —
// more robust than `sticky`, which still depends on the parent's overflow.
//
// Colours come from the theme-aware modal primitives in globals.css
// (modal-surface / modal-card / modal-pre / tone-* / callout-*). No raw
// dark-only utility like `text-emerald-300` is used for anything that must stay
// readable, because those drop to ~2:1 contrast on a white modal surface.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, ArrowLeft, Loader2, Copy, Check, ChevronDown, ChevronRight, Search,
  AlertTriangle, Database, Hash, Info, Sparkles, FileSearch,
} from "lucide-react";

type Tab = "overview" | "text" | "chunks" | "metadata" | "search";

type Detail = {
  id: string; assistantId: string; type: string; url: string;
  title: string | null; status: string; error: string | null;
  fileName: string | null; mimeType: string | null; fileSize: number | null;
  fileHash: string | null;
  pageCount: number; distinctPages: number; chunkCount: number;
  totalChars: number; embeddedCount: number;
  embeddingModel: string; embeddingDimensions: number; minSimilarity: number;
  lastSyncedAt: string | null; createdAt: string | null;
  firstIndexedAt: string | null; lastChunkUpdatedAt: string | null;
};

type PageItem = {
  index: number; url: string; title: string | null; label: string;
  pageNo: number | null; chunkCount: number; chars: number; text: string;
  orderKnown: boolean;
};

type Chunk = {
  id: string; number: number; position: number; url: string;
  title: string | null; label: string; pageNo: number | null;
  indexInPage: number | null; chars: number; approxTokens: number;
  content: string; contentHash: string;
  metadata: Record<string, unknown>;
  hasEmbedding: boolean; embeddingDimensions: number;
  createdAt: string | null; updatedAt: string | null;
};

type Hit = {
  similarity: number; content: string; url: string; title: string | null;
  label: string; chunkId: string; sourceId: string;
  metadata?: Record<string, unknown>;
};

/** Readable "which file / which page" for a retrieved chunk.
 *  File chunks encode both in the url as file://<name>#<label>, and for URL
 *  chunks the label IS the page title — so the two lines were identical and
 *  the card showed the same text twice. */
function hitOrigin(h: Hit): { source: string; page: string } {
  const u = h.url || "";
  if (u.startsWith("file://")) {
    const [file, frag] = u.slice("file://".length).split("#");
    return { source: decodeURIComponent(file), page: frag || h.label };
  }
  const page = h.label && h.label !== u ? h.label : (h.title || "");
  return { source: u, page: page === u ? "" : page };
}

/** The stored chunk's own number, when the retrieval carried it. */
function hitChunkNumber(h: Hit): number | null {
  const i = h.metadata?.chunk_index;
  return typeof i === "number" ? i + 1 : null;
}

type AnswerPreview = {
  answer: string;
  status: "ok" | "no_knowledge" | "unavailable" | "failed";
  model: string;
  note: string;
};

type SearchResult = {
  hits: Hit[];
  minSimilarity: number;
  retrievalAvailable: boolean;
  retrievalNote: string;
  answerPreview?: AnswerPreview;
};

const PAGE_SIZE = 20;

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "text", label: "Extracted Text" },
  { id: "chunks", label: "Chunks" },
  { id: "metadata", label: "Metadata" },
  { id: "search", label: "Test Search" },
];

const DT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const fmtDate = (s: string | null) => (s ? DT.format(new Date(s)) : "—");
const fmtNum = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString() : "—";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked — nothing useful to say */
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-300 transition hover:bg-white/[0.08]"
    >
      {done ? <Check size={10} /> : <Copy size={10} />}
      {done ? "Copied" : label}
    </button>
  );
}

/** One label/value line, used throughout Overview and Metadata. */
function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-1.5 last:border-0">
      <span className="shrink-0 text-[11px] text-gray-500">{k}</span>
      <span className={`min-w-0 break-words text-right text-[11px] ${mono ? "font-mono" : ""}`}>
        {v}
      </span>
    </div>
  );
}

export default function KnowledgeInspector({
  assistantId,
  source,
  onClose,
}: {
  assistantId: string;
  source: { id: string; type: string; url: string; title: string | null; fileName: string | null };
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [pages, setPages] = useState<PageItem[] | null>(null);
  const [reassembled, setReassembled] = useState(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A chunk opened from the Chunks list. Back returns here, not out of the
  // modal, and the list's page + filter are untouched while this is open.
  const [detailChunk, setDetailChunk] = useState<Chunk | null>(null);

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [vectors, setVectors] = useState<Record<string, number[] | "loading" | "error">>({});

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Lets the Escape handler call the latest requestClose without depending on
  // its identity (which would rebind the listener on every render).
  const requestCloseRef = useRef<() => void>(() => {});
  const base = `/api/knowledge/${encodeURIComponent(assistantId)}/${encodeURIComponent(source.id)}/inspect`;
  const name = source.fileName || source.title || source.url;
  const sourceLabel = source.fileName || (() => {
    try { return new URL(source.url).hostname; } catch { return source.url; }
  })();

  // ── Scroll lock ───────────────────────────────────────────────────────────
  // body:overflow-hidden (not position:fixed) keeps the page where it was, so
  // opening and closing never jumps the background. The offset is restored
  // anyway, because a browser that drops it would otherwise scroll to top.
  useEffect(() => {
    const y = window.scrollY;
    document.body.classList.add("modal-open");
    return () => {
      document.body.classList.remove("modal-open");
      window.scrollTo(0, y);
    };
  }, []);

  // ── Navigation: Escape, and the browser Back button ───────────────────────
  // Opening pushes one history entry so Back closes the modal instead of
  // leaving the assistant page. Closing any other way pops it again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (detailChunk) setDetailChunk(null);   // Escape backs out one level first
      else requestCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailChunk]);

  // One history entry is pushed so the browser Back button closes the modal
  // instead of leaving the assistant page.
  //
  // The push is ref-guarded and the cleanup does NOT unwind it. React's dev
  // StrictMode runs every effect mount -> cleanup -> mount; an unwind in that
  // cleanup fired a popstate that closed the modal the instant it opened.
  // Instead, every UI close path goes through requestClose(), which pops the entry
  // itself, so the entry is unwound exactly once by whoever closes.
  const pushed = useRef(false);
  useEffect(() => {
    if (!pushed.current) {
      window.history.pushState({ jjInspector: true }, "");
      pushed.current = true;
    }
    const onPop = () => { pushed.current = false; onClose(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onClose]);

  /** Close from the UI: unwind our history entry, which then calls onClose. */
  const requestClose = useCallback<() => void>(() => {
    if (pushed.current && window.history.state?.jjInspector) {
      window.history.back();      // -> popstate -> onClose
    } else {
      onClose();
    }
  }, [onClose]);
  requestCloseRef.current = requestClose;

  // ── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${base}?view=detail`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) setError(j.error || `Could not load this source (HTTP ${r.status}).`);
        else setDetail(j);
      } catch {
        if (alive) setError("Could not reach the server.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [base]);

  // Extracted text is lazy — fetched the first time its tab is opened.
  useEffect(() => {
    if (tab !== "text" || pages !== null) return;
    let alive = true;
    (async () => {
      setBusy(true);
      try {
        const r = await fetch(`${base}?view=pages`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (r.ok) { setPages(j.pages || []); setReassembled(Boolean(j.reassembledFromChunks)); }
        else setError(j.error || "Could not load the extracted text.");
      } catch {
        if (alive) setError("Could not reach the server.");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [tab, pages, base]);

  const loadChunks = useCallback(async (off: number, q: string) => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ view: "chunks", offset: String(off), limit: String(PAGE_SIZE) });
      if (q) qs.set("q", q);
      const r = await fetch(`${base}?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) { setChunks(j.chunks || []); setTotal(j.total || 0); setOffset(j.offset || 0); }
      else setError(j.error || "Could not load the stored chunks.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [base]);

  // Chunks and Metadata share the same paginated list, fetched once.
  const chunksRequested = useRef(false);
  useEffect(() => {
    if (tab !== "chunks" && tab !== "metadata") return;
    if (chunksRequested.current) return;
    chunksRequested.current = true;
    void loadChunks(0, "");
  }, [tab, loadChunks]);

  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFilter = (v: string) => {
    setFilter(v);
    if (filterTimer.current) clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => void loadChunks(0, v.trim()), 300);
  };

  // Changing tab returns the reader to the top of the new tab, but never
  // resets that tab's own state (page, filter, expanded sections).
  const goTab = (t: Tab) => {
    setTab(t);
    setDetailChunk(null);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const showVector = async (chunkId: string) => {
    setVectors((m) => ({ ...m, [chunkId]: "loading" }));
    try {
      const r = await fetch(`${base}?view=vector&chunkId=${encodeURIComponent(chunkId)}`,
                            { cache: "no-store" });
      const j = await r.json();
      setVectors((m) => ({ ...m, [chunkId]: r.ok && Array.isArray(j.vector) ? j.vector : "error" }));
    } catch {
      setVectors((m) => ({ ...m, [chunkId]: "error" }));
    }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchFailed(false);
    setResult(null);
    try {
      const r = await fetch(`/api/knowledge/${encodeURIComponent(assistantId)}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, top_k: 8, answer: true }),
      });
      const j = await r.json();
      if (!r.ok) { setSearchFailed(true); return; }
      setResult({
        hits: j.hits || [],
        minSimilarity: j.minSimilarity ?? 0,
        // Default true so an older voice-service is not reported as broken.
        retrievalAvailable: j.retrievalAvailable !== false,
        retrievalNote: j.retrievalNote || "",
        answerPreview: j.answerPreview,
      });
    } catch {
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  };

  const pageNo = Math.floor(offset / PAGE_SIZE) + 1;
  const pageMax = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Back goes up one level: chunk detail -> Chunks list -> out of the modal.
  const onBack = () => {
    if (detailChunk) { setDetailChunk(null); return; }
    requestClose();
  };
  const backLabel = detailChunk ? "Back to Chunks" : "Back";

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] transition hover:bg-white/[0.08] disabled:opacity-40";

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Indexed data for ${name}`}
    >
      <div
        className="modal-surface flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER — outside the scroll area, so it never scrolls away */}
        <div className="modal-bar flex shrink-0 items-center gap-3 border-b p-3 sm:p-4">
          <button type="button" onClick={onBack} className={btn} aria-label={backLabel}>
            <ArrowLeft size={13} /> {backLabel}
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-sm font-semibold sm:text-base">
              {detailChunk ? `Chunk #${detailChunk.number}` : "Indexed Knowledge"}
            </h2>
            <p className="truncate text-[11px] text-gray-500">
              {detailChunk ? detailChunk.label : `${source.type} · ${name}`}
            </p>
          </div>
          <button
            type="button" onClick={requestClose} aria-label="Close"
            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-1.5 transition hover:bg-white/[0.08]"
          >
            <X size={14} />
          </button>
        </div>

        {/* TABS — also outside the scroll area. Hidden in chunk detail, where
            Back is the only meaningful move. */}
        {!detailChunk && (
          <div className="modal-bar flex shrink-0 gap-1 overflow-x-auto border-b px-2 pt-2 sm:px-3">
            {TABS.map((t) => (
              <button
                key={t.id} type="button" onClick={() => goTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`shrink-0 rounded-t-lg px-3 py-2 text-xs font-medium transition ${
                  tab === t.id
                    ? "border-b-2 border-violet-400 text-fg"
                    : "border-b-2 border-transparent text-gray-500 hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* CONTENT — the only scrollable region */}
        {/* overflow-y-auto / overscroll-contain are Tailwind utilities on purpose:
            relying on a custom .modal-scroll rule meant one stale CSS build left
            the panel unscrollable with no error anywhere. */}
        <div ref={scrollRef}
             className="modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {loading && (
            <p className="flex items-center gap-2 py-8 text-xs text-gray-500">
              <Loader2 size={13} className="animate-spin" /> Loading indexed data…
            </p>
          )}

          {error && !loading && (
            <p className="callout-warn flex items-start gap-2 rounded-lg p-3 text-[11px]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {/* ── Chunk detail ─────────────────────────────────────────────── */}
          {!loading && detailChunk && (
            <div className="space-y-3">
              <div className="modal-card rounded-xl p-3">
                <Row k="Chunk number" v={`#${detailChunk.number}`} />
                <Row k="Source" v={sourceLabel} />
                <Row k="Page / section" v={detailChunk.label} />
                <Row k="Size" v={`${fmtNum(detailChunk.chars)} characters · ~${fmtNum(detailChunk.approxTokens)} words`} />
                <Row k="Embedding" v={
                  <span className={detailChunk.hasEmbedding ? "tone-good" : "tone-warn"}>
                    {detailChunk.hasEmbedding
                      ? `Generated ✓ · ${detailChunk.embeddingDimensions} dimensions`
                      : "not embedded"}
                  </span>
                } />
                <Row k="content_hash" v={detailChunk.contentHash} mono />
                <Row k="chunk id" v={detailChunk.id} mono />
                <Row k="created_at" v={fmtDate(detailChunk.createdAt)} />
                <Row k="updated_at" v={fmtDate(detailChunk.updatedAt)} />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-gray-500">Stored text</span>
                  <CopyButton text={detailChunk.content} label="Copy text" />
                </div>
                <pre className="modal-pre whitespace-pre-wrap break-words rounded-lg p-3 text-[11px] leading-relaxed">
                  {detailChunk.content}
                </pre>
              </div>
            </div>
          )}

          {/* ── Overview ─────────────────────────────────────────────────── */}
          {!loading && !detailChunk && tab === "overview" && detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: source.type === "URL" ? "Pages indexed" : "Items indexed",
                    v: fmtNum(detail.distinctPages || detail.pageCount) },
                  { k: "Chunks stored", v: fmtNum(detail.chunkCount) },
                  { k: "Characters", v: fmtNum(detail.totalChars) },
                  { k: "Embedded", v: `${fmtNum(detail.embeddedCount)} / ${fmtNum(detail.chunkCount)}` },
                ].map((s) => (
                  <div key={s.k} className="modal-card rounded-xl p-3">
                    <div className="text-lg font-semibold">{s.v}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">{s.k}</div>
                  </div>
                ))}
              </div>

              <div className="modal-card rounded-xl p-3">
                <Row k="Source" v={name} />
                {source.type === "URL"
                  ? <Row k="URL" v={detail.url} mono />
                  : <Row k="File name" v={detail.fileName || "—"} />}
                <Row k="Type" v={detail.type} />
                <Row k="Status" v={
                  <span className={detail.status === "READY" ? "tone-good" : "tone-warn"}>
                    {detail.status}
                  </span>
                } />
                {detail.mimeType && <Row k="Content type" v={detail.mimeType} mono />}
                <Row k="Embedding model" v={detail.embeddingModel} mono />
                <Row k="Vector dimensions" v={detail.embeddingDimensions} />
                <Row k="Similarity threshold" v={`${detail.minSimilarity} — below this a chunk is not used`} />
                <Row k="Last indexed" v={fmtDate(detail.lastSyncedAt)} />
                <Row k="Assistant ID" v={detail.assistantId} mono />
              </div>

              {detail.error && (
                <p className="callout-warn flex items-start gap-2 rounded-lg p-3 text-[11px]">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{detail.error}</span>
                </p>
              )}
            </div>
          )}

          {/* ── Extracted Text ───────────────────────────────────────────── */}
          {!loading && !detailChunk && tab === "text" && (
            <div className="space-y-3">
              {busy && pages === null && (
                <p className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" /> Loading extracted text…
                </p>
              )}
              {reassembled && (
                <p className="callout-info flex items-start gap-2 rounded-lg p-2.5 text-[11px]">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  <span>
                    This is the text that was <strong>actually stored and embedded</strong>,
                    reassembled from its chunks in reading order — the pre-chunk
                    extractor output is not kept, so this is what the voice agent
                    can really retrieve.
                  </span>
                </p>
              )}
              {pages?.length === 0 && (
                <p className="py-6 text-center text-xs text-gray-500">
                  Nothing is stored for this source yet.
                </p>
              )}
              {pages?.map((p) => {
                const key = `pg-${p.index}`;
                const isOpen = open[key] ?? p.index === 1;
                return (
                  <div key={key} className="modal-card rounded-xl">
                    <button
                      type="button"
                      onClick={() => setOpen((m) => ({ ...m, [key]: !isOpen }))}
                      className="flex w-full items-start gap-2 p-3 text-left"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-gray-500" />
                              : <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-500" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{p.label}</div>
                        <div className="truncate text-[10px] text-gray-500">
                          {source.type === "URL" ? p.url : p.title}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] text-gray-500">
                        {fmtNum(p.chars)} chars · {p.chunkCount} chunks
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-white/5 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          {!p.orderKnown && (
                            <span className="tone-warn text-[10px]">
                              Stored before chunk order was recorded — re-index to
                              show this page in exact reading order.
                            </span>
                          )}
                          <CopyButton text={p.text} label="Copy text" />
                        </div>
                        <pre className="modal-pre max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 text-[11px] leading-relaxed">
                          {p.text}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Chunks ───────────────────────────────────────────────────── */}
          {!loading && !detailChunk && tab === "chunks" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={filter}
                    onChange={(e) => onFilter(e.target.value)}
                    placeholder="Search within stored chunks…"
                    className="w-full rounded-lg border border-white/10 bg-black/30 py-1.5 pl-7 pr-3 text-xs placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  />
                </div>
                <span className="shrink-0 text-[11px] text-gray-500">
                  {fmtNum(total)} {total === 1 ? "chunk" : "chunks"}
                </span>
              </div>

              {busy && (
                <p className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </p>
              )}
              {!busy && chunks.length === 0 && (
                <p className="py-6 text-center text-xs text-gray-500">
                  {filter ? "No stored chunk contains that text." : "No chunks stored."}
                </p>
              )}

              {chunks.map((c) => (
                <div key={c.id} className="modal-card rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">Chunk #{c.number}</div>
                      <div className="mt-0.5 truncate text-[10px] text-gray-500">
                        Source: {sourceLabel}
                      </div>
                      <div className="truncate text-[10px] text-gray-500">{c.label}</div>
                    </div>
                    {/* No similarity here on purpose: a chunk has no score until
                        it is matched against a question. Scores appear in Test
                        Search only. */}
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {fmtNum(c.chars)} chars
                    </span>
                  </div>
                  <pre className="modal-pre mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg p-2.5 text-[11px] leading-relaxed">
                    {c.content}
                  </pre>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`text-[10px] ${c.hasEmbedding ? "tone-good" : "tone-warn"}`}>
                      {c.hasEmbedding
                        ? `Embedding Generated ✓ · ${c.embeddingDimensions} dims`
                        : "No embedding"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <CopyButton text={c.content} />
                      <button
                        type="button"
                        onClick={() => { setDetailChunk(c); scrollRef.current?.scrollTo({ top: 0 }); }}
                        className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] transition hover:bg-white/[0.08]"
                      >
                        <FileSearch size={10} /> View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button" disabled={offset === 0 || busy} className={btn}
                    onClick={() => void loadChunks(Math.max(0, offset - PAGE_SIZE), filter.trim())}
                  >
                    ← Previous
                  </button>
                  <span className="text-[11px] text-gray-500">Page {pageNo} of {pageMax}</span>
                  <button
                    type="button" disabled={offset + PAGE_SIZE >= total || busy} className={btn}
                    onClick={() => void loadChunks(offset + PAGE_SIZE, filter.trim())}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Metadata ─────────────────────────────────────────────────── */}
          {!loading && !detailChunk && tab === "metadata" && detail && (
            <div className="space-y-4">
              <div className="modal-card rounded-xl p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                  <Database size={12} /> Source
                </div>
                <Row k="source_id" v={detail.id} mono />
                <Row k="assistant_id" v={detail.assistantId} mono />
                <Row k="source_type" v={detail.type} mono />
                <Row k={source.type === "URL" ? "url" : "filename"}
                     v={source.type === "URL" ? detail.url : (detail.fileName || "—")} mono />
                <Row k="status" v={detail.status} mono />
                {detail.fileHash && <Row k="file_hash" v={detail.fileHash} mono />}
                {detail.fileSize != null && <Row k="file_size" v={`${fmtNum(detail.fileSize)} bytes`} mono />}
                <Row k="created_at" v={fmtDate(detail.createdAt)} />
                <Row k="updated_at" v={fmtDate(detail.lastChunkUpdatedAt || detail.lastSyncedAt)} />
                <Row k="embedding_status" v={
                  <span className={detail.embeddedCount === detail.chunkCount && detail.chunkCount > 0
                    ? "tone-good" : "tone-warn"}>
                    {detail.chunkCount === 0 ? "nothing stored"
                      : detail.embeddedCount === detail.chunkCount
                        ? "Embedding Generated ✓"
                        : `${detail.embeddedCount} of ${detail.chunkCount} embedded`}
                  </span>
                } />
                <Row k="embedding_dimension" v={detail.embeddingDimensions} mono />
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                  <Hash size={12} /> Chunks {total ? `(page ${pageNo} of ${pageMax})` : ""}
                </div>
                {busy && (
                  <p className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={13} className="animate-spin" /> Loading…
                  </p>
                )}
                <div className="space-y-2">
                  {chunks.map((c) => {
                    const vec = vectors[c.id];
                    return (
                      <div key={c.id} className="modal-card rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold">Chunk #{c.number}</span>
                          <span className="truncate text-[10px] text-gray-500">{c.label}</span>
                        </div>
                        <Row k="page / section / sheet" v={c.label} />
                        {c.pageNo != null && <Row k="page_no" v={c.pageNo} mono />}
                        <Row k="content_hash" v={c.contentHash} mono />
                        <Row k="created_at" v={fmtDate(c.createdAt)} />
                        <Row k="updated_at" v={fmtDate(c.updatedAt)} />
                        <Row k="embedding_status" v={
                          <span className={c.hasEmbedding ? "tone-good" : "tone-warn"}>
                            {c.hasEmbedding ? "Embedding Generated ✓" : "not embedded"}
                          </span>
                        } />
                        <Row k="embedding_dimension" v={c.hasEmbedding ? c.embeddingDimensions : "—"} mono />

                        {/* Raw vectors are never loaded by default — 384 floats
                            per chunk that nobody normally reads. */}
                        {c.hasEmbedding && (
                          <div className="pt-2">
                            {vec === undefined && (
                              <button type="button" onClick={() => void showVector(c.id)}
                                      className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] transition hover:bg-white/[0.08]">
                                Show Raw Vector
                              </button>
                            )}
                            {vec === "loading" && (
                              <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
                                <Loader2 size={10} className="animate-spin" /> Loading vector…
                              </span>
                            )}
                            {vec === "error" && (
                              <span className="tone-warn text-[10px]">Could not load the vector.</span>
                            )}
                            {Array.isArray(vec) && (
                              <div>
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-gray-500">{vec.length} dimensions</span>
                                  <div className="flex items-center gap-1.5">
                                    <CopyButton text={JSON.stringify(vec)} label="Copy vector" />
                                    <button
                                      type="button"
                                      onClick={() => setVectors((m) => {
                                        const next = { ...m }; delete next[c.id]; return next;
                                      })}
                                      className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] hover:bg-white/[0.08]"
                                    >
                                      Hide
                                    </button>
                                  </div>
                                </div>
                                <pre className="modal-pre max-h-32 overflow-auto whitespace-pre-wrap break-all rounded p-2 font-mono text-[10px]">
                                  [{vec.map((x) => x.toFixed(5)).join(", ")}]
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {total > PAGE_SIZE && (
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button type="button" disabled={offset === 0 || busy} className={btn}
                            onClick={() => void loadChunks(Math.max(0, offset - PAGE_SIZE), filter.trim())}>
                      ← Previous
                    </button>
                    <span className="text-[11px] text-gray-500">Page {pageNo} of {pageMax}</span>
                    <button type="button" disabled={offset + PAGE_SIZE >= total || busy} className={btn}
                            onClick={() => void loadChunks(offset + PAGE_SIZE, filter.trim())}>
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Test Search ──────────────────────────────────────────────── */}
          {!loading && !detailChunk && tab === "search" && (
            <div className="space-y-3">
              <p className="callout-info flex items-start gap-2 rounded-lg p-2.5 text-[11px]">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>
                  Shows what JillJill would retrieve and say if a caller asked this.
                  It runs the <strong>same retrieval the voice agent uses</strong> —
                  same embedding model, same pgvector ranking, same similarity
                  floor — across everything this assistant knows, not just this
                  source.
                </span>
              </p>

              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                  placeholder="What services does VIMS Enterprise provide?"
                  className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
                <button
                  type="button" onClick={() => void runSearch()}
                  disabled={searching || !query.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-300 via-violet-300 to-pink-300 px-3 py-2 text-xs font-semibold text-black transition hover:from-cyan-200 hover:via-violet-200 hover:to-pink-200 disabled:opacity-50"
                >
                  {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  Test
                </button>
              </div>

              {searching && (
                <p className="flex items-center gap-2 py-4 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" />
                  Retrieving knowledge and drafting the answer…
                </p>
              )}

              {/* Request failed outright. */}
              {searchFailed && !searching && (
                <p className="callout-bad flex items-start gap-2 rounded-lg p-3 text-[11px]">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>Knowledge search failed. Please retry.</span>
                </p>
              )}

              {/* Retrieval cannot run at all — distinct from "nothing matched". */}
              {result && !result.retrievalAvailable && (
                <p className="callout-bad flex items-start gap-2 rounded-lg p-3 text-[11px]">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>Retrieval is unavailable in this voice-service</strong> — this
                    is not a &ldquo;no results&rdquo; answer. {result.retrievalNote} Until
                    that is fixed, a live call cannot use this knowledge either.
                  </span>
                </p>
              )}

              {/* ANSWER PREVIEW */}
              {result && result.retrievalAvailable && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                    <Sparkles size={12} /> Answer Preview
                  </div>
                  {result.hits.length === 0 ? (
                    <div className="modal-card rounded-xl p-3 text-[11px]">
                      <p className="font-medium">No relevant knowledge found.</p>
                      <p className="mt-1 text-gray-500">
                        Nothing scored above the {result.minSimilarity} similarity floor, so
                        on a real call JillJill would say it does not have that confirmed
                        rather than guess.
                      </p>
                    </div>
                  ) : result.answerPreview?.status === "ok" && result.answerPreview.answer ? (
                    <div className="callout-good rounded-xl p-3">
                      <p className="text-xs leading-relaxed">{result.answerPreview.answer}</p>
                      <p className="mt-2 text-[10px] opacity-80">
                        Drafted only from the chunks below
                        {result.answerPreview.model ? ` · ${result.answerPreview.model}` : ""}
                      </p>
                    </div>
                  ) : (
                    <div className="callout-warn rounded-xl p-3 text-[11px]">
                      {result.answerPreview?.note
                        || "The answer preview could not be generated. The retrieved knowledge below is still exactly what a call would use."}
                    </div>
                  )}
                </div>
              )}

              {/* RETRIEVED CHUNKS */}
              {result && result.retrievalAvailable && result.hits.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-gray-500">
                      Retrieved Chunks
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {result.hits.length} above the {result.minSimilarity} floor · a call uses the best 4
                    </span>
                  </div>
                  <div className="space-y-2">
                    {result.hits.map((h, i) => {
                      const mine = h.sourceId === source.id;
                      const origin = hitOrigin(h);
                      const chunkNo = hitChunkNumber(h);
                      return (
                        <div key={h.chunkId || i}
                             className={`rounded-xl p-3 ${mine ? "modal-card-active" : "modal-card"}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-semibold">#{i + 1}</span>
                                {chunkNo !== null && (
                                  <span className="text-[10px] text-gray-500">Chunk #{chunkNo}</span>
                                )}
                                <span className="tone-good rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
                                  {Math.round(h.similarity * 100)}% · {h.similarity.toFixed(3)}
                                </span>
                                {i < 4 && (
                                  <span className="tone-good text-[9px] uppercase tracking-wide">
                                    used on a call
                                  </span>
                                )}
                                {!mine && (
                                  <span className="text-[9px] uppercase tracking-wide text-gray-500">
                                    another source
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 truncate text-[10px] text-gray-500">
                                {origin.source}
                              </div>
                              {origin.page && (
                                <div className="truncate text-[10px] text-gray-500">{origin.page}</div>
                              )}
                            </div>
                            <CopyButton text={h.content} />
                          </div>
                          <pre className="modal-pre mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg p-2.5 text-[11px] leading-relaxed">
                            {h.content}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Nothing run yet — never leave the panel blank. */}
              {!result && !searching && !searchFailed && (
                <p className="py-6 text-center text-xs text-gray-500">
                  Ask a question above to see what a caller would get.
                </p>
              )}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="modal-bar flex shrink-0 items-center justify-between gap-3 border-t px-3 py-2.5 sm:px-4">
          <span className="text-[10px] text-gray-500">Read-only view of stored data</span>
          <button type="button" onClick={requestClose} className={btn}>Close</button>
        </div>
      </div>
    </div>
  );
}
