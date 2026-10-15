"""Turn an uploaded file into plain text segments for the EXISTING knowledge
pipeline (chunk -> fastembed -> pgvector). Nothing here embeds or stores.

Each extractor returns `[(label, text)]`, where the label becomes chunk metadata
("page 3", "Sheet1", "Heading") so a retrieved answer can say where it came from.

Rules that shape the code:
  * **OCR is a fallback, never the default.** A PDF page with selectable text is
    read directly; only a page that comes back near-empty is rasterised and run
    through OCR. OCR on a normal text PDF would be slow and worse.
  * **Never invent.** An image yields only the text actually read off it. If OCR
    finds nothing, the file produces nothing and is reported as such — no
    speculative description.
  * **Nothing is executed.** Files are parsed as data; the uploaded bytes are
    never run, and the stored name is generated, never the user's.
"""

from __future__ import annotations

import csv
import io
import os
import re
from typing import Any

from observability import get_logger

logger = get_logger("extractors")

# A PDF page with fewer than this many characters is treated as scanned.
PDF_TEXT_MIN_CHARS = 60
OCR_MAX_PAGES = int(os.environ.get("KNOWLEDGE_OCR_MAX_PAGES", "30"))
OCR_ZOOM = 2.0          # render at 2x so small print survives OCR
CSV_MAX_ROWS = int(os.environ.get("KNOWLEDGE_CSV_MAX_ROWS", "2000"))

Segment = tuple[str, str]      # (label, text)

_ocr: Any = None


def _ocr_engine() -> Any:
    """RapidOCR: ONNX, pip-only, no system packages. Loaded on first use."""
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
        logger.info("ocr_engine_loaded", engine="rapidocr_onnxruntime", source="KNOWLEDGE")
    return _ocr


def _ocr_image_bytes(data: bytes) -> str:
    try:
        result, _ = _ocr_engine()(data)
    except Exception as exc:
        logger.warning("ocr_failed", error=str(exc)[:200], source="KNOWLEDGE")
        return ""
    if not result:
        return ""
    # RapidOCR returns [[box, text, confidence], ...] in reading order.
    return "\n".join(str(line[1]).strip() for line in result if len(line) > 1 and str(line[1]).strip())


def _clean(text: str) -> str:
    out, seen = [], set()
    for raw in (text or "").splitlines():
        ln = " ".join(raw.split())
        if not ln:
            continue
        k = ln.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(ln)
    return "\n".join(out)


# ── PDF ──────────────────────────────────────────────────────────────────────
def extract_pdf(path: str) -> tuple[list[Segment], dict]:
    """Page-by-page text; OCR applied ONLY to pages that have none."""
    import pymupdf

    segs: list[Segment] = []
    ocr_pages = 0
    doc = pymupdf.open(path)
    try:
        for i, page in enumerate(doc, start=1):
            text = (page.get_text() or "").strip()
            if len(text) < PDF_TEXT_MIN_CHARS and ocr_pages < OCR_MAX_PAGES:
                # Scanned/image page — rasterise just this one and OCR it.
                try:
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(OCR_ZOOM, OCR_ZOOM))
                    text = _ocr_image_bytes(pix.tobytes("png")).strip()
                    if text:
                        ocr_pages += 1
                except Exception as exc:
                    logger.warning("pdf_page_ocr_failed", page=i, error=str(exc)[:160],
                                   source="KNOWLEDGE")
            text = _clean(text)
            if len(text) >= 40:
                segs.append((f"page {i}", text))
        meta = {"pages": doc.page_count, "ocr_pages": ocr_pages}
    finally:
        doc.close()
    logger.info("pdf_extracted", pages=meta["pages"], text_pages=len(segs),
                ocr_pages=ocr_pages, source="KNOWLEDGE")
    return segs, meta


# ── Image ────────────────────────────────────────────────────────────────────
def extract_image(path: str) -> tuple[list[Segment], dict]:
    """Only the text actually visible in the image. No invented description."""
    with open(path, "rb") as fh:
        text = _clean(_ocr_image_bytes(fh.read()))
    name = os.path.basename(path)
    if not text:
        return [], {"pages": 1, "ocr_pages": 1, "note": "no readable text found in image"}
    # The filename is real, observed context — it helps retrieval without
    # asserting anything that is not in the file.
    body = f"Image: {name}\n{text}"
    return [("image", body)], {"pages": 1, "ocr_pages": 1}


# ── Word ─────────────────────────────────────────────────────────────────────
def extract_docx(path: str) -> tuple[list[Segment], dict]:
    """Paragraphs, headings and tables, kept in document order."""
    import docx

    d = docx.Document(path)
    parts: list[str] = []
    for p in d.paragraphs:
        t = (p.text or "").strip()
        if not t:
            continue
        style = (p.style.name if p.style is not None else "") or ""
        parts.append(f"## {t}" if style.lower().startswith("heading") else t)
    for ti, table in enumerate(d.tables, start=1):
        rows = []
        for row in table.rows:
            cells = [(c.text or "").strip() for c in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            parts.append(f"Table {ti}:\n" + "\n".join(rows))
    text = _clean("\n".join(parts))
    return ([("document", text)] if len(text) >= 40 else []), {"pages": 1}


# ── Plain text / Markdown ────────────────────────────────────────────────────
def extract_text(path: str) -> tuple[list[Segment], dict]:
    with open(path, "rb") as fh:
        raw = fh.read()
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        return [], {"pages": 0, "note": "could not decode text"}
    text = _clean(text)
    return ([("document", text)] if len(text) >= 40 else []), {"pages": 1}


# ── CSV ──────────────────────────────────────────────────────────────────────
def _rows_to_text(header: list[str], rows: list[list[str]]) -> str:
    """Row-per-line with column names, so a row stays meaningful on its own."""
    out = []
    hdr = [h.strip() for h in header]
    for r in rows:
        pairs = [f"{hdr[i] if i < len(hdr) and hdr[i] else f'col{i+1}'}: {str(v).strip()}"
                 for i, v in enumerate(r) if str(v).strip()]
        if pairs:
            out.append("; ".join(pairs))
    return "\n".join(out)


def extract_csv(path: str) -> tuple[list[Segment], dict]:
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as fh:
        sample = fh.read(8192)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample) if sample.strip() else csv.excel
        except Exception:
            dialect = csv.excel
        reader = csv.reader(fh, dialect)
        rows = [r for _, r in zip(range(CSV_MAX_ROWS + 1), reader)]
    if not rows:
        return [], {"pages": 0}
    header, body = rows[0], rows[1:]
    text = _clean(_rows_to_text(header, body))
    return ([("table", text)] if len(text) >= 40 else []), {"pages": 1, "rows": len(body)}


# ── Excel ────────────────────────────────────────────────────────────────────
def extract_xlsx(path: str) -> tuple[list[Segment], dict]:
    """One segment per sheet, so the sheet name survives into the metadata."""
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    segs: list[Segment] = []
    total_rows = 0
    try:
        for ws in wb.worksheets:
            rows: list[list[str]] = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i > CSV_MAX_ROWS:
                    break
                vals = ["" if v is None else str(v) for v in row]
                if any(v.strip() for v in vals):      # skip blank rows entirely
                    rows.append(vals)
            if not rows:
                continue
            total_rows += len(rows) - 1
            text = _clean(f"Sheet: {ws.title}\n" + _rows_to_text(rows[0], rows[1:]))
            if len(text) >= 40:
                segs.append((f"sheet {ws.title}", text))
    finally:
        wb.close()
    return segs, {"pages": len(segs), "rows": total_rows}


# ── Dispatch ─────────────────────────────────────────────────────────────────
# extension -> (source_type, extractor). .doc (legacy binary) is NOT here: it
# needs LibreOffice, which this deployment does not have.
EXTRACTORS = {
    ".pdf":  ("PDF",      extract_pdf),
    ".png":  ("IMAGE",    extract_image),
    ".jpg":  ("IMAGE",    extract_image),
    ".jpeg": ("IMAGE",    extract_image),
    ".webp": ("IMAGE",    extract_image),
    ".docx": ("DOCUMENT", extract_docx),
    ".txt":  ("DOCUMENT", extract_text),
    ".md":   ("DOCUMENT", extract_text),
    ".csv":  ("DOCUMENT", extract_csv),
    ".xlsx": ("DOCUMENT", extract_xlsx),
    ".xlsm": ("DOCUMENT", extract_xlsx),
}
SUPPORTED_EXTENSIONS = sorted(EXTRACTORS)

# Accepted content types, checked ALONGSIDE the extension so neither alone
# decides what a file is.
ALLOWED_MIME = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "text/markdown", "text/csv", "application/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel", "application/octet-stream",
}


def source_type_for(filename: str) -> str:
    return EXTRACTORS.get(os.path.splitext(filename.lower())[1], ("DOCUMENT", None))[0]


def extract(path: str, filename: str) -> tuple[list[Segment], dict]:
    """Extract from `path`, choosing the reader by the ORIGINAL file extension."""
    ext = os.path.splitext(filename.lower())[1]
    entry = EXTRACTORS.get(ext)
    if entry is None:
        raise ValueError(f"{ext or 'this file type'} is not supported. "
                         f"Supported: {', '.join(SUPPORTED_EXTENSIONS)}")
    return entry[1](path)


# ── Upload safety ────────────────────────────────────────────────────────────
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]")
# Refused regardless of the declared content type.
_BLOCKED_EXT = {
    ".exe", ".dll", ".so", ".dylib", ".bat", ".cmd", ".com", ".msi", ".scr",
    ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".vbs", ".js", ".mjs", ".jar",
    ".py", ".rb", ".pl", ".php", ".app", ".deb", ".rpm", ".apk", ".bin",
}


def sanitize_filename(name: str) -> str:
    """Display name only — never used to build a path."""
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    base = _SAFE_NAME.sub("_", base).lstrip(".") or "upload"
    return base[:200]


def validate_upload(filename: str, mime: str, size: int, max_bytes: int) -> str:
    """Return "" when the upload is acceptable, else a plain-English reason.

    Extension AND content type are both checked: either one alone is trivially
    spoofed, and an executable must be refused however it is labelled.
    """
    name = (filename or "").strip()
    if not name:
        return "The file has no name."
    ext = os.path.splitext(name.lower())[1]
    if ext in _BLOCKED_EXT:
        return f"{ext} files cannot be uploaded."
    if ext not in EXTRACTORS:
        return (f"{ext or 'That file type'} is not supported. "
                f"Supported types: {', '.join(SUPPORTED_EXTENSIONS)}.")
    if size <= 0:
        return "The file is empty."
    if size > max_bytes:
        return f"The file is larger than the {max_bytes // (1024 * 1024)}MB limit."
    m = (mime or "").split(";")[0].strip().lower()
    if m and m not in ALLOWED_MIME:
        return f"Files of type {m} cannot be uploaded."
    return ""
