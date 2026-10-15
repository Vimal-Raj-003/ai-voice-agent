"""Per-assistant website knowledge: crawl -> extract -> chunk -> embed -> search.

Design rules that matter more than the code:

* **Isolation is enforced in SQL, not in application logic.** Every read and
  write carries `assistant_id`, and the similarity query filters on it before
  ranking. One assistant can never surface another's pages.
* **Embeddings run locally** (fastembed, ONNX, CPU). Every hosted embedding API
  available to this deployment is billing-blocked, and a knowledge base that
  stops working when credits lapse is worse than none. The model is
  multilingual: a Tamil question retrieves the matching English page.
* **Grounding is a retrieval decision.** If nothing clears the similarity floor
  we return nothing, so the agent says it doesn't know instead of inventing.
* Crawling is deliberately conservative: same host only, capped pages, capped
  bytes, no login/admin paths, and a visited set so loops terminate.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Iterable
from urllib.parse import urldefrag, urljoin, urlparse

import httpx

import config
import db
import extractors
from observability import get_logger

logger = get_logger("knowledge")

EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
EMBED_DIM = 384
# Below this cosine similarity a chunk is not considered an answer.
#
# MEASURED 2026-10-13 over a mixed URL+PDF+image+document corpus: questions the
# corpus genuinely answers scored 0.332-0.693, unrelated ones 0.069-0.288. The
# previous 0.40 floor sat INSIDE the relevant band and silently rejected five
# answerable questions ("Can I pay by card?" 0.332, "Which insurers do you
# accept?" 0.394), so the agent claimed it had no information it actually held.
#
# 0.30 clears every measured relevant question and still rejects every measured
# irrelevant one. Being slightly permissive here is the safer direction: the
# grounding block tells the model to answer ONLY if the text covers the
# question, so a marginal chunk is filtered again by the model — whereas a chunk
# that retrieval drops can never be recovered.
#
# Absolute similarity is corpus-dependent; re-measure with real content before
# assuming this number transfers.
MIN_SIMILARITY = float(os.environ.get("KNOWLEDGE_MIN_SIMILARITY", "0.30"))
MAX_PAGES = int(os.environ.get("KNOWLEDGE_MAX_PAGES", "25"))
MAX_BYTES_PER_PAGE = 2_000_000
PAGE_TIMEOUT_S = 20.0
CHUNK_CHARS = 900
CHUNK_OVERLAP = 150
UA = "JillJillBot/1.0 (+website knowledge indexer)"
# Uploaded files live outside the repo, under a generated name.
FILES_DIR = os.environ.get(
    "KNOWLEDGE_FILES_DIR", "/tmp/jilljill-knowledge-files")
MAX_UPLOAD_BYTES = int(os.environ.get(
    "KNOWLEDGE_MAX_UPLOAD_MB", "25")) * 1024 * 1024

# Paths that are private, pointless or dangerous to index.
_SKIP_PATH = re.compile(
    r"/(login|signin|sign-in|signup|sign-up|register|admin|wp-admin|wp-login|account|"
    r"cart|checkout|logout|password|reset|dashboard|api|feed|rss)(/|$|\?)", re.I)
_SKIP_EXT = re.compile(
    r"\.(pdf|zip|rar|7z|tar|gz|jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|wav|avi|mov|"
    r"css|js|json|xml|woff2?|ttf|eot)$", re.I)
# Chrome that repeats on every page and carries no answer.
_NOISE_TAGS = ("script", "style", "noscript", "nav", "header", "footer", "aside",
               "form", "iframe", "svg", "button", "template")
_NOISE_PAT = re.compile(
    r"(cookie|consent|privacy policy|terms of service|subscribe to our newsletter|"
    r"all rights reserved|accept all|manage preferences|skip to (main )?content)", re.I)

_embedder: Any = None
_embed_lock = asyncio.Lock()


# ── embeddings ───────────────────────────────────────────────────────────────
def _load_embedder() -> Any:
    """Load once per process. First call downloads ~470MB, then it is cached."""
    global _embedder
    if _embedder is None:
        from fastembed import TextEmbedding
        t0 = time.monotonic()
        _embedder = TextEmbedding(EMBED_MODEL)
        logger.info("knowledge_embedder_loaded", model=EMBED_MODEL, dim=EMBED_DIM,
                    load_ms=int((time.monotonic() - t0) * 1000), source="KNOWLEDGE")
    return _embedder


def embedder_status() -> dict:
    """Whether this process can embed at all, without loading the model.

    `search()` deliberately swallows embedding failures and returns [] so a
    live call degrades to "I don't have that confirmed" instead of crashing.
    That is right for a call and wrong for the "Test Knowledge Search" screen,
    where an empty result would otherwise be indistinguishable from "retrieval
    is broken in this process". Read-only and cheap: it checks that the module
    can be found, it does not import or download anything.
    """
    if _embedder is not None:
        return {"available": True, "note": ""}
    import importlib.util
    if importlib.util.find_spec("fastembed") is None:
        return {"available": False,
                "note": ("The embedding library (fastembed) is not installed in "
                         "this voice-service environment, so queries cannot be "
                         "embedded and no stored chunk can ever match.")}
    return {"available": True, "note": ""}


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed off the event loop — the model is CPU-bound and would stall audio."""
    if not texts:
        return []
    async with _embed_lock:
        def _run() -> list[list[float]]:
            m = _load_embedder()
            return [v.tolist() for v in m.embed(texts)]
        return await asyncio.to_thread(_run)


def _vec_literal(v: list[float]) -> str:
    """pgvector accepts '[1,2,3]'; asyncpg has no native vector codec."""
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


# ── fetch + extract ──────────────────────────────────────────────────────────
def normalize_url(raw: str) -> str | None:
    """Canonical absolute http(s) URL, or None if unusable."""
    u = (raw or "").strip()
    if not u:
        return None
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    try:
        p = urlparse(u)
    except Exception:
        return None
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    u, _ = urldefrag(u)                      # #anchors are the same page
    return u.rstrip("/") or u


def _extract(html: str, url: str) -> tuple[str, str]:
    """(title, visible text) with chrome and boilerplate removed."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    title = (soup.title.get_text(strip=True) if soup.title else "") or urlparse(url).netloc
    for tag in soup(list(_NOISE_TAGS)):
        tag.decompose()
    # Cookie/consent widgets are usually divs, not <nav>; drop by role/class hint.
    for el in soup.find_all(attrs={"class": _NOISE_PAT}):
        el.decompose()
    for el in soup.find_all(attrs={"id": _NOISE_PAT}):
        el.decompose()
    text = soup.get_text("\n", strip=True)
    lines, seen = [], set()
    for ln in (l.strip() for l in text.split("\n")):
        # Drop one-word nav crumbs, repeated lines and boilerplate sentences.
        if len(ln) < 3 or _NOISE_PAT.search(ln):
            continue
        k = ln.lower()
        if k in seen:
            continue
        seen.add(k)
        lines.append(ln)
    return title[:300], "\n".join(lines)


def _links(html: str, base: str, host: str) -> list[str]:
    from bs4 import BeautifulSoup
    out: list[str] = []
    for a in BeautifulSoup(html, "lxml").find_all("a", href=True):
        nxt = normalize_url(urljoin(base, a["href"]))
        if not nxt:
            continue
        p = urlparse(nxt)
        if p.netloc != host:            # never leave the site
            continue
        if _SKIP_PATH.search(p.path) or _SKIP_EXT.search(p.path):
            continue
        out.append(nxt)
    return out


# Many marketing sites ship an empty HTML shell and render in the browser. When
# the plain fetch yields almost no text we retry through a headless browser, if
# one is usable. It is optional on purpose: the dependency is heavy, so a
# deployment without it still indexes ordinary server-rendered sites.
_RENDER_MIN_TEXT = 200
# How long to wait for XHR to quiet, then a short settle for the paint that
# often lands just after. Both bounded so a slow site cannot hang a sync.
RENDER_SETTLE_S = float(os.environ.get("KNOWLEDGE_RENDER_SETTLE_S", "8"))
RENDER_SETTLE_MS = int(os.environ.get("KNOWLEDGE_RENDER_SETTLE_MS", "1200"))
_render_state: dict[str, Any] = {"checked": False, "ok": False, "reason": ""}


async def _render_available() -> tuple[bool, str]:
    """Probe once per process. Uses the ASYNC Playwright API: the sync API
    refuses to run inside an asyncio loop, which this service always has."""
    global _render_state
    if not _render_state["checked"]:
        _render_state["checked"] = True
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                b = await p.chromium.launch(args=["--no-sandbox"])
                await b.close()
            _render_state.update(ok=True, reason="")
            logger.info("knowledge_render_ready", source="KNOWLEDGE")
        except Exception as exc:
            msg = str(exc)
            if "libnspr" in msg or "shared librar" in msg:
                reason = ("a headless browser is installed but its system libraries are "
                          "missing - run: sudo /home/jilljill2023/venvs/jilljill-voice/bin/"
                          "python -m playwright install-deps chromium")
            elif "Executable doesn" in msg:
                reason = "headless browser not downloaded - run: playwright install chromium"
            else:
                reason = f"headless browser unavailable: {msg[:140]}"
            _render_state.update(ok=False, reason=reason)
            logger.info("knowledge_render_unavailable", reason=reason, source="KNOWLEDGE")
    return _render_state["ok"], _render_state["reason"]


@dataclass
class Rendered:
    """What a real browser saw. `body_text` is the authoritative content for a
    client-rendered page — re-parsing the rendered HTML through the server-side
    stripper can delete legitimate React markup, so the visible text is used
    directly."""
    url: str
    title: str = ""
    body_text: str = ""
    html: str = ""
    links: list[str] = field(default_factory=list)


def clean_visible_text(text: str) -> str:
    """Tidy browser-visible text WITHOUT removing page content.

    Only collapses blank runs, drops exact repeat lines (nav/footer echoed on
    every screen) and obvious cookie/consent furniture. Everything else is kept
    verbatim — this text has already been through the browser, so there is no
    markup left to strip.
    """
    out: list[str] = []
    seen: set[str] = set()
    for raw in (text or "").splitlines():
        ln = " ".join(raw.split())
        if not ln:
            continue
        if _NOISE_PAT.search(ln) and len(ln) < 200:   # cookie/consent furniture
            continue
        key = ln.lower()
        if key in seen:                                # repeated nav/footer line
            continue
        seen.add(key)
        out.append(ln)
    return "\n".join(out)


async def _render(url: str) -> Rendered:
    """Load `url` in a real browser and return what a human would see."""
    ok, _ = await _render_available()
    if not ok:
        return Rendered(url=url)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--no-sandbox"])
            try:
                pg = await b.new_page(user_agent=UA)
                # Structure first, then let XHR settle, then a short bounded
                # pause for frameworks that paint just after the network quiets.
                await pg.goto(url, wait_until="domcontentloaded",
                              timeout=int(PAGE_TIMEOUT_S * 1000))
                try:
                    await pg.wait_for_load_state("networkidle",
                                                 timeout=int(RENDER_SETTLE_S * 1000))
                except Exception:
                    pass          # a site with polling never goes idle; carry on
                await pg.wait_for_timeout(int(RENDER_SETTLE_MS))
                title = (await pg.title()) or ""
                try:
                    body_text = await pg.locator("body").inner_text()
                except Exception:
                    body_text = ""
                html = await pg.content()
                links = await pg.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
                r = Rendered(url=url, title=title.strip()[:300],
                             body_text=body_text or "", html=html or "",
                             links=[str(l) for l in links])
                logger.info("knowledge_render_completed", url=url, title=r.title,
                            html_chars=len(r.html), body_text_chars=len(r.body_text),
                            link_count=len(r.links), source="KNOWLEDGE")
                return r
            finally:
                await b.close()
    except Exception as exc:
        logger.info("knowledge_render_failed", url=url, error=str(exc)[:160], source="KNOWLEDGE")
        return Rendered(url=url)


@dataclass
class Page:
    url: str
    title: str
    text: str


@dataclass
class CrawlResult:
    pages: list[Page] = field(default_factory=list)
    error: str = ""


async def crawl(root: str, max_pages: int = MAX_PAGES) -> CrawlResult:
    """Breadth-first over ONE host, bounded by max_pages and a visited set."""
    start = normalize_url(root)
    if not start:
        return CrawlResult(error="That does not look like a valid website address.")
    host = urlparse(start).netloc
    seen: set[str] = {start}
    queue: list[str] = [start]
    pages: list[Page] = []
    res = CrawlResult()

    async with httpx.AsyncClient(
        timeout=PAGE_TIMEOUT_S, follow_redirects=True,
        headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
    ) as client:
        while queue and len(pages) < max_pages:
            url = queue.pop(0)
            try:
                r = await client.get(url)
            except Exception as exc:
                logger.info("knowledge_page_skipped", url=url, error=str(exc)[:120], source="KNOWLEDGE")
                if url == start:
                    res.error = f"Could not reach the site: {str(exc)[:120]}"
                continue
            ctype = r.headers.get("content-type", "")
            if r.status_code != 200 or "html" not in ctype.lower():
                if url == start:
                    res.error = f"The site returned HTTP {r.status_code}."
                continue
            html = r.text[:MAX_BYTES_PER_PAGE]
            title, text = _extract(html, url)
            extra_links: list[str] = []
            if len(text) < _RENDER_MIN_TEXT:
                # Looks like a JavaScript shell — load it in a real browser and
                # take the VISIBLE TEXT. Re-parsing the rendered HTML through the
                # server-side stripper is what previously threw this content away.
                r2 = await _render(url)
                visible = clean_visible_text(r2.body_text)
                if len(visible.strip()) >= 120:
                    title = r2.title or title
                    text = visible
                    if r2.html:
                        html = r2.html[:MAX_BYTES_PER_PAGE]   # links only
                    extra_links = [u for u in (normalize_url(l) for l in r2.links)
                                   if u and urlparse(u).netloc == host
                                   and not _SKIP_PATH.search(urlparse(u).path)
                                   and not _SKIP_EXT.search(urlparse(u).path)]
                else:
                    logger.info("knowledge_render_thin", url=url,
                                body_text_chars=len(r2.body_text),
                                cleaned_chars=len(visible.strip()),
                                html_chars=len(r2.html), source="KNOWLEDGE")
                    if url == start:
                        ok, why = await _render_available()
                        res.error = (
                            f"The browser rendered this page but only {len(visible.strip())} "
                            "characters of text were visible."
                            if ok else
                            "This site builds its pages in the browser, so its text "
                            f"cannot be read without a headless browser ({why}).")
            if len(text) >= 120:                 # ignore near-empty shells
                pages.append(Page(url=url, title=title, text=text))
            for nxt in _links(html, url, host) + extra_links:
                if nxt not in seen and len(seen) < max_pages * 6:
                    seen.add(nxt)
                    queue.append(nxt)

    res.pages = pages
    if not pages and not res.error:
        res.error = "No readable text was found on that site."
    return res


# ── chunking ─────────────────────────────────────────────────────────────────
def chunk_text(text: str) -> list[str]:
    """Paragraph-aware chunks with overlap, so an answer is not split in half."""
    paras = [p.strip() for p in re.split(r"\n{1,}", text) if p.strip()]
    chunks: list[str] = []
    cur = ""
    for p in paras:
        if len(cur) + len(p) + 1 <= CHUNK_CHARS:
            cur = f"{cur}\n{p}" if cur else p
            continue
        if cur:
            chunks.append(cur)
            cur = (cur[-CHUNK_OVERLAP:] + "\n" + p) if CHUNK_OVERLAP else p
        else:
            # A single oversized paragraph: hard-split it.
            for i in range(0, len(p), CHUNK_CHARS):
                chunks.append(p[i:i + CHUNK_CHARS])
            cur = ""
    if cur:
        chunks.append(cur)
    return [c for c in (c.strip() for c in chunks) if len(c) >= 80]


def _hash(assistant_id: str, content: str) -> str:
    norm = re.sub(r"\s+", " ", content).strip().lower()
    return hashlib.sha256(f"{assistant_id}\x00{norm}".encode()).hexdigest()


# ── indexing ─────────────────────────────────────────────────────────────────
async def sync_source(source_id: str) -> dict:
    """Crawl + re-index one source. Safe to call repeatedly (idempotent)."""
    pool = await db.get_pool()
    src = await pool.fetchrow(
        'SELECT id, assistant_id, url, type, file_path, file_name '
        'FROM knowledge_sources WHERE id = $1', source_id)
    if not src:
        return {"ok": False, "error": "source not found"}
    aid, url = src["assistant_id"], src["url"]

    stype = (src["type"] or "URL").upper()
    await pool.execute("UPDATE knowledge_sources SET status='CRAWLING', error=NULL, "
                       "updated_at=NOW() WHERE id=$1", source_id)
    logger.info("knowledge_sync_started", source_id=source_id, assistant_id=aid,
                url=url, source_type=stype, source="KNOWLEDGE")
    t0 = time.monotonic()

    # URL and file sources differ ONLY in how text is obtained; chunking,
    # embedding, storage and isolation below are identical for both.
    pages: list[Page] = []
    page_count = 0
    err = ""
    if stype == "URL":
        result = await crawl(url)
        pages, err = result.pages, result.error
        page_count = len(pages)
    else:
        fpath = src["file_path"]
        fname = src["file_name"] or os.path.basename(fpath or "")
        if not fpath or not os.path.exists(fpath):
            err = "The uploaded file is no longer available on the server."
        else:
            try:
                # Parsing and OCR are CPU-bound; keep them off the event loop so
                # a live call is never stalled by an upload.
                segs, meta = await asyncio.to_thread(extractors.extract, fpath, fname)
                page_count = int(meta.get("pages") or len(segs))
                for label, text in segs:
                    pages.append(Page(url=f"file://{fname}#{label}",
                                      title=f"{fname} ({label})", text=text))
                if not pages:
                    err = (meta.get("note")
                           or f"No readable text was found in {fname}.")
                logger.info("knowledge_file_extracted", source_id=source_id,
                            file=fname, source_type=stype, segments=len(segs),
                            **{k: v for k, v in meta.items() if isinstance(v, int)},
                            source="KNOWLEDGE")
            except Exception as exc:
                err = str(exc)[:300]

    if err and not pages:
        await pool.execute("UPDATE knowledge_sources SET status='FAILED', error=$2, "
                           "updated_at=NOW() WHERE id=$1", source_id, err[:500])
        logger.warning("knowledge_sync_failed", source_id=source_id, url=url,
                       source_type=stype, error=err[:200], source="KNOWLEDGE")
        return {"ok": False, "error": err}

    class _R:                     # keeps the shared code below unchanged
        pass
    result = _R()
    result.pages = pages

    # Build chunks, de-duplicated by content hash across the whole source.
    # Chunking itself is unchanged; each chunk now also carries its POSITION so
    # the "View Indexed Data" screen can show a page's text in the order it was
    # actually read. Nothing else can recover that order: chunk ids are content
    # hashes and every row in one sync shares a created_at.
    rows: list[dict] = []
    seen: set[str] = set()
    for page_no, pg in enumerate(result.pages, start=1):
        for i, c in enumerate(chunk_text(pg.text)):
            h = _hash(aid, c)
            if h in seen:
                continue
            seen.add(h)
            rows.append({"hash": h, "url": pg.url, "title": pg.title, "content": c,
                         "page_no": page_no, "index_in_page": i, "index": len(rows)})

    vectors = await embed_texts([r["content"] for r in rows])

    async with pool.acquire() as con:
        async with con.transaction():
            # Replace this source's chunks wholesale: obsolete content disappears,
            # while the source record (and its history) is preserved.
            await con.execute("DELETE FROM knowledge_chunks WHERE source_id=$1", source_id)
            for r, vec in zip(rows, vectors):
                await con.execute(
                    """INSERT INTO knowledge_chunks
                         (id, assistant_id, source_id, url, title, content, embedding,
                          metadata, content_hash, created_at, updated_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb,$9,NOW(),NOW())
                       ON CONFLICT (assistant_id, content_hash) DO UPDATE
                         SET source_id=EXCLUDED.source_id, url=EXCLUDED.url,
                             title=EXCLUDED.title, embedding=EXCLUDED.embedding,
                             updated_at=NOW()""",
                    hashlib.sha1(f"{source_id}{r['hash']}".encode()).hexdigest(),
                    aid, source_id, r["url"], r["title"], r["content"], _vec_literal(vec),
                    json.dumps({
                        "chars": len(r["content"]),
                        # Position within the source and within its page.
                        "chunk_index": r["index"],
                        "index_in_page": r["index_in_page"],
                        "page_no": r["page_no"],
                        "page_label": page_label(r["url"], r["title"], r["page_no"]),
                    }), r["hash"])
            title = result.pages[0].title if result.pages else None
            await con.execute(
                "UPDATE knowledge_sources SET status='READY', title=$2, page_count=$3, "
                "last_synced_at=NOW(), error=NULL, updated_at=NOW() WHERE id=$1",
                source_id, title, page_count or len(result.pages))

    logger.info("knowledge_sync_completed", source_id=source_id, assistant_id=aid, url=url,
                pages=len(result.pages), chunks=len(rows),
                elapsed_ms=int((time.monotonic() - t0) * 1000), source="KNOWLEDGE")
    return {"ok": True, "pages": len(result.pages), "chunks": len(rows)}


async def add_source(assistant_id: str, raw_url: str) -> dict:
    """Register a URL for this assistant and index it. Re-adding = re-sync."""
    url = normalize_url(raw_url)
    if not url:
        return {"ok": False, "error": "That does not look like a valid website address."}
    pool = await db.get_pool()
    row = await pool.fetchrow(
        """INSERT INTO knowledge_sources (id, assistant_id, type, url, status, created_at, updated_at)
           VALUES ($1,$2,'URL',$3,'PENDING',NOW(),NOW())
           ON CONFLICT (assistant_id, url) DO UPDATE SET status='PENDING', updated_at=NOW()
           RETURNING id""",
        hashlib.sha1(f"{assistant_id}{url}".encode()).hexdigest(), assistant_id, url)
    return {"ok": True, "id": row["id"], "url": url}


async def add_file(assistant_id: str, filename: str, mime: str, data: bytes) -> dict:
    """Validate, store under a GENERATED name, register, and return the source id.

    The uploaded name is only ever a label: the path is built from a hash, so a
    crafted filename cannot traverse out of the uploads directory.
    """
    reason = extractors.validate_upload(filename, mime, len(data), MAX_UPLOAD_BYTES)
    if reason:
        return {"ok": False, "error": reason}

    safe_name = extractors.sanitize_filename(filename)
    stype = extractors.source_type_for(safe_name)
    fhash = hashlib.sha256(data).hexdigest()
    ext = os.path.splitext(safe_name.lower())[1]

    os.makedirs(FILES_DIR, exist_ok=True)
    # Generated path: assistant + content hash. Re-uploading the same file
    # overwrites the same bytes instead of accumulating copies.
    disk = os.path.join(FILES_DIR, f"{hashlib.sha1(assistant_id.encode()).hexdigest()[:12]}_{fhash[:32]}{ext}")
    with open(disk, "wb") as fh:
        fh.write(data)

    pool = await db.get_pool()
    row = await pool.fetchrow(
        """INSERT INTO knowledge_sources
             (id, assistant_id, type, url, title, status, file_name, file_path,
              mime_type, file_size, file_hash, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,NOW(),NOW())
           -- The unique index is PARTIAL (WHERE file_hash IS NOT NULL), so the
           -- predicate must be repeated here for Postgres to match it.
           ON CONFLICT (assistant_id, file_hash) WHERE file_hash IS NOT NULL DO UPDATE
             SET status='PENDING', file_name=EXCLUDED.file_name,
                 file_path=EXCLUDED.file_path, updated_at=NOW()
           RETURNING id""",
        hashlib.sha1(f"{assistant_id}{fhash}".encode()).hexdigest(),
        assistant_id, stype, f"file://{safe_name}", safe_name, safe_name, disk,
        (mime or "").split(";")[0].strip().lower(), len(data), fhash)
    logger.info("knowledge_file_uploaded", assistant_id=assistant_id, file=safe_name,
                source_type=stype, bytes=len(data), source="KNOWLEDGE")
    return {"ok": True, "id": row["id"], "fileName": safe_name, "type": stype}


async def list_sources(assistant_id: str) -> list[dict]:
    pool = await db.get_pool()
    rows = await pool.fetch(
        """SELECT s.id, s.url, s.title, s.status, s.page_count, s.last_synced_at,
                  s.error, s.created_at, s.type, s.file_name, s.mime_type, s.file_size,
                  (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.source_id = s.id) AS chunk_count
             FROM knowledge_sources s
            WHERE s.assistant_id = $1
            ORDER BY s.created_at DESC""", assistant_id)
    return [{
        "id": r["id"], "url": r["url"], "title": r["title"], "status": r["status"],
        "type": r["type"], "fileName": r["file_name"], "mimeType": r["mime_type"],
        "fileSize": r["file_size"],
        "pageCount": r["page_count"], "chunkCount": r["chunk_count"],
        "lastSyncedAt": r["last_synced_at"].isoformat() if r["last_synced_at"] else None,
        "error": r["error"],
    } for r in rows]


def page_label(url: str, title: str | None, page_no: int) -> str:
    """Human label for one indexed page / section / sheet.

    File sources encode their segment in the chunk url as
    `file://<name>#<label>` (e.g. "Page 4", "Sheet1"), which is where this
    reads it from. URL sources have no such fragment, so they fall back to the
    page title and finally to an ordinal.
    """
    u = url or ""
    if u.startswith("file://") and "#" in u:
        frag = u.rsplit("#", 1)[1].strip()
        if frag:
            return frag
    t = (title or "").strip()
    if t:
        return t
    return f"Page {page_no}"


# ── Read-only inspection ("View Indexed Data") ───────────────────────────────
# Everything below only ever READS. Every query is filtered by assistant_id AND
# source_id together, so a source id guessed or copied from another assistant
# returns nothing rather than someone else's content.

async def _owned_source(assistant_id: str, source_id: str) -> dict | None:
    pool = await db.get_pool()
    row = await pool.fetchrow(
        """SELECT id, assistant_id, type, url, title, status, page_count,
                  last_synced_at, error, created_at, updated_at,
                  file_name, mime_type, file_size, file_hash
             FROM knowledge_sources
            WHERE id = $1 AND assistant_id = $2""",
        source_id, assistant_id)
    return dict(row) if row else None


async def source_detail(assistant_id: str, source_id: str) -> dict | None:
    """Overview figures for one source: what was indexed, and with what model."""
    src = await _owned_source(assistant_id, source_id)
    if src is None:
        return None
    pool = await db.get_pool()
    agg = await pool.fetchrow(
        """SELECT COUNT(*)                                   AS chunk_count,
                  COALESCE(SUM(LENGTH(content)), 0)          AS total_chars,
                  COUNT(embedding)                           AS embedded_count,
                  COUNT(DISTINCT url)                        AS distinct_pages,
                  MIN(created_at)                            AS first_indexed,
                  MAX(updated_at)                            AS last_updated
             FROM knowledge_chunks
            WHERE assistant_id = $1 AND source_id = $2""",
        assistant_id, source_id)
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "id": src["id"],
        "assistantId": src["assistant_id"],
        "type": src["type"],
        "url": src["url"],
        "title": src["title"],
        "status": src["status"],
        "error": src["error"],
        "fileName": src["file_name"],
        "mimeType": src["mime_type"],
        "fileSize": src["file_size"],
        "fileHash": src["file_hash"],
        # page_count is what the extractor reported; distinctPages is what is
        # actually stored. They can differ when a page yielded no text.
        "pageCount": src["page_count"],
        "distinctPages": int(agg["distinct_pages"] or 0),
        "chunkCount": int(agg["chunk_count"] or 0),
        "totalChars": int(agg["total_chars"] or 0),
        "embeddedCount": int(agg["embedded_count"] or 0),
        "embeddingModel": EMBED_MODEL,
        "embeddingDimensions": EMBED_DIM,
        "minSimilarity": MIN_SIMILARITY,
        "lastSyncedAt": iso(src["last_synced_at"]),
        "createdAt": iso(src["created_at"]),
        "firstIndexedAt": iso(agg["first_indexed"]),
        "lastChunkUpdatedAt": iso(agg["last_updated"]),
    }


def _chunk_sort_key(meta: dict) -> tuple:
    """Order chunks the way they were read, when the metadata records it.

    Rows written before positions were recorded have no chunk_index; they sort
    last, in a stable order, and the UI says their order is unknown.
    """
    has = isinstance(meta.get("chunk_index"), int)
    return (0 if has else 1,
            meta.get("page_no") if isinstance(meta.get("page_no"), int) else 0,
            meta.get("index_in_page") if isinstance(meta.get("index_in_page"), int) else 0,
            meta.get("chunk_index") if has else 0)


async def source_pages(assistant_id: str, source_id: str) -> dict | None:
    """The indexed text, grouped by page / section / sheet.

    IMPORTANT, and surfaced in the UI: the pre-chunk extracted text is not
    stored anywhere, so each page's text here is its stored chunks joined back
    together in reading order. That is exactly the text that was embedded and
    is therefore what the voice agent can retrieve — but it is a reassembly,
    not a separate copy of the extractor's output.
    """
    src = await _owned_source(assistant_id, source_id)
    if src is None:
        return None
    pool = await db.get_pool()
    rows = await pool.fetch(
        """SELECT id, url, title, content, metadata
             FROM knowledge_chunks
            WHERE assistant_id = $1 AND source_id = $2""",
        assistant_id, source_id)

    grouped: dict[str, dict] = {}
    for r in rows:
        meta = _meta_of(r["metadata"])
        key = r["url"] or ""
        g = grouped.setdefault(key, {
            "url": r["url"],
            "title": r["title"],
            "label": meta.get("page_label") or page_label(r["url"], r["title"], 0),
            "pageNo": meta.get("page_no"),
            "parts": [],
        })
        g["parts"].append((_chunk_sort_key(meta), r["content"]))

    pages = []
    ordered = sorted(grouped.values(),
                     key=lambda g: (g["pageNo"] if isinstance(g["pageNo"], int) else 10**6,
                                    g["url"] or ""))
    for i, g in enumerate(ordered, start=1):
        parts = [c for _, c in sorted(g["parts"], key=lambda t: t[0])]
        text = "\n\n".join(parts)
        pages.append({
            "index": i,
            "url": g["url"],
            "title": g["title"],
            "label": g["label"] or f"Page {i}",
            "pageNo": g["pageNo"],
            "chunkCount": len(parts),
            "chars": len(text),
            "text": text,
            # True when every chunk on this page recorded its position.
            "orderKnown": all(k[0] == 0 for k, _ in g["parts"]),
        })
    return {
        "sourceId": source_id,
        "assistantId": assistant_id,
        "type": src["type"],
        "fileName": src["file_name"],
        "reassembledFromChunks": True,
        "pages": pages,
    }


def _meta_of(raw: Any) -> dict:
    """metadata comes back as JSON text or an already-parsed dict."""
    if isinstance(raw, dict):
        return raw
    try:
        out = json.loads(raw or "{}")
        return out if isinstance(out, dict) else {}
    except Exception:
        return {}


async def source_chunks(assistant_id: str, source_id: str, *, offset: int = 0,
                        limit: int = 20, q: str = "") -> dict | None:
    """One page of stored chunks, newest-first by position, optionally filtered.

    Chunk text is returned in full and never summarised: the point of this
    screen is to show exactly what is stored. Embeddings are NOT returned —
    they are fetched separately, only when explicitly asked for.
    """
    src = await _owned_source(assistant_id, source_id)
    if src is None:
        return None
    limit = max(1, min(int(limit or 20), 100))
    offset = max(0, int(offset or 0))
    needle = (q or "").strip()

    pool = await db.get_pool()
    # Fetch ids + metadata only, so ordering can use the recorded position
    # before paginating. A source holds tens to low thousands of chunks, so this
    # stays cheap; content is fetched for the requested slice only.
    index_rows = await pool.fetch(
        """SELECT id, metadata, url, title
             FROM knowledge_chunks
            WHERE assistant_id = $1 AND source_id = $2
              AND ($3 = '' OR content ILIKE '%' || $3 || '%')""",
        assistant_id, source_id, needle)
    ordered = sorted(index_rows, key=lambda r: _chunk_sort_key(_meta_of(r["metadata"])))
    total = len(ordered)
    window = ordered[offset:offset + limit]
    if not window:
        return {"sourceId": source_id, "total": total, "offset": offset,
                "limit": limit, "query": needle, "chunks": []}

    ids = [r["id"] for r in window]
    full = await pool.fetch(
        """SELECT id, url, title, content, metadata, content_hash,
                  created_at, updated_at,
                  (embedding IS NOT NULL) AS has_embedding
             FROM knowledge_chunks
            WHERE assistant_id = $1 AND source_id = $2 AND id = ANY($3::text[])""",
        assistant_id, source_id, ids)
    by_id = {r["id"]: r for r in full}

    chunks = []
    for pos, idx_row in enumerate(window, start=offset + 1):
        r = by_id.get(idx_row["id"])
        if r is None:
            continue
        meta = _meta_of(r["metadata"])
        chunks.append({
            "id": r["id"],
            "number": (meta["chunk_index"] + 1
                       if isinstance(meta.get("chunk_index"), int) else pos),
            "position": pos,
            "url": r["url"],
            "title": r["title"],
            "label": meta.get("page_label") or page_label(r["url"], r["title"], 0),
            "pageNo": meta.get("page_no"),
            "indexInPage": meta.get("index_in_page"),
            "chars": len(r["content"] or ""),
            # Whitespace-delimited word count. Not a model tokenizer count, and
            # labelled as approximate in the UI so it is not mistaken for one.
            "approxTokens": len((r["content"] or "").split()),
            "content": r["content"],
            "contentHash": r["content_hash"],
            "metadata": meta,
            "hasEmbedding": bool(r["has_embedding"]),
            "embeddingDimensions": EMBED_DIM if r["has_embedding"] else 0,
            "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
            "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
        })
    return {"sourceId": source_id, "assistantId": assistant_id, "total": total,
            "offset": offset, "limit": limit, "query": needle,
            "sourceType": src["type"], "fileName": src["file_name"],
            "chunks": chunks}


async def chunk_vector(assistant_id: str, source_id: str, chunk_id: str) -> dict | None:
    """The raw embedding for ONE chunk, only when explicitly requested.

    Kept out of the list responses on purpose: 384 floats per chunk would
    dominate the payload and nobody reads them by default.
    """
    pool = await db.get_pool()
    row = await pool.fetchrow(
        """SELECT embedding::text AS vec
             FROM knowledge_chunks
            WHERE assistant_id = $1 AND source_id = $2 AND id = $3""",
        assistant_id, source_id, chunk_id)
    if row is None or not row["vec"]:
        return None
    try:
        values = [float(x) for x in row["vec"].strip("[]").split(",") if x.strip()]
    except ValueError:
        return None
    return {"chunkId": chunk_id, "model": EMBED_MODEL,
            "dimensions": len(values), "vector": values}


async def delete_source(assistant_id: str, source_id: str) -> dict:
    """Scoped by assistant_id so one assistant cannot delete another's source."""
    pool = await db.get_pool()
    # Read the path first: the row (and its chunks, via cascade) is about to go.
    row = await pool.fetchrow(
        "SELECT file_path FROM knowledge_sources WHERE id=$1 AND assistant_id=$2",
        source_id, assistant_id)
    res = await pool.execute(
        "DELETE FROM knowledge_sources WHERE id=$1 AND assistant_id=$2", source_id, assistant_id)
    ok = res.endswith("1")
    if ok and row and row["file_path"]:
        try:
            # Only ever inside the uploads directory.
            fp = os.path.abspath(row["file_path"])
            if fp.startswith(os.path.abspath(FILES_DIR) + os.sep) and os.path.exists(fp):
                os.remove(fp)
                logger.info("knowledge_file_deleted", source_id=source_id,
                            assistant_id=assistant_id, source="KNOWLEDGE")
        except Exception as exc:
            logger.warning("knowledge_file_delete_failed", error=str(exc)[:160],
                           source="KNOWLEDGE")
    return {"ok": ok}


# ── retrieval ────────────────────────────────────────────────────────────────
async def search(assistant_id: str, query: str, top_k: int = 4) -> list[dict]:
    """Most relevant chunks for THIS assistant, or [] when nothing is relevant.

    Returning [] is a feature: the caller then tells the model it has no
    confirmed information, which is what stops invented answers.
    """
    q = (query or "").strip()
    if not q or not assistant_id:
        return []
    try:
        vec = (await embed_texts([q]))[0]
    except Exception as exc:
        logger.warning("knowledge_embed_failed", error=str(exc)[:200], source="KNOWLEDGE")
        return []
    pool = await db.get_pool()
    rows = await pool.fetch(
        # id / source_id / metadata are selected so the read-only "Test
        # Knowledge Search" screen can say WHICH stored chunk was matched.
        # Purely additive: the filter, the ordering, the vector operator, the
        # threshold and the limit are untouched, and build_context() reads only
        # `content`, so the live call path behaves exactly as before.
        """SELECT id, source_id, metadata,
                  url, title, content, 1 - (embedding <=> $2::vector) AS similarity
             FROM knowledge_chunks
            WHERE assistant_id = $1 AND embedding IS NOT NULL
            ORDER BY embedding <=> $2::vector
            LIMIT $3""",
        assistant_id, _vec_literal(vec), top_k)
    hits = [{"url": r["url"], "title": r["title"], "content": r["content"],
             "similarity": float(r["similarity"]),
             "chunkId": r["id"], "sourceId": r["source_id"],
             "metadata": _meta_of(r["metadata"]),
             "label": (_meta_of(r["metadata"]).get("page_label")
                       or page_label(r["url"], r["title"], 0))}
            for r in rows if float(r["similarity"]) >= MIN_SIMILARITY]
    logger.info("knowledge_search", assistant_id=assistant_id, query=q[:120],
                candidates=len(rows), kept=len(hits),
                best=round(max((h["similarity"] for h in hits), default=0.0), 3),
                source="KNOWLEDGE")
    return hits


def build_context(hits: Iterable[dict]) -> str:
    """Compact grounding block for the LLM. Never mentions how it was produced."""
    hits = list(hits)
    if not hits:
        return ""
    parts = ["[BUSINESS INFORMATION — answer from this when it covers the question; "
             "if it does not, say you don't have that confirmed rather than guessing]"]
    for h in hits:
        parts.append(f"- {h['content'].strip()}")
    return "\n".join(parts)
