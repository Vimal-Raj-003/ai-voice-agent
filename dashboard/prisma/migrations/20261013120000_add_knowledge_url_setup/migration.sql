-- URL Setup knowledge base, per assistant.
-- Hand-written (not `prisma migrate dev`) because this database has pre-existing
-- drift that would otherwise force a full reset. Additive only.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "knowledge_sources" (
    "id"             TEXT PRIMARY KEY,
    "assistant_id"   TEXT NOT NULL,
    "type"           TEXT NOT NULL DEFAULT 'URL',
    "url"            TEXT NOT NULL,
    "title"          TEXT,
    -- PENDING | CRAWLING | READY | FAILED
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "page_count"     INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "error"          TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_sources_assistant_fk" FOREIGN KEY ("assistant_id")
        REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- One record per URL per assistant; re-adding the same URL syncs it instead.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_assistant_url_key"
    ON "knowledge_sources"("assistant_id", "url");
CREATE INDEX IF NOT EXISTS "knowledge_sources_assistant_idx"
    ON "knowledge_sources"("assistant_id");

CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
    "id"           TEXT PRIMARY KEY,
    "assistant_id" TEXT NOT NULL,
    "source_id"    TEXT NOT NULL,
    "url"          TEXT NOT NULL,
    "title"        TEXT,
    "content"      TEXT NOT NULL,
    -- 384 dims = sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2,
    -- chosen because it retrieves English content from Tamil questions.
    "embedding"    vector(384),
    "metadata"     JSONB,
    "content_hash" TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_chunks_source_fk" FOREIGN KEY ("source_id")
        REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_chunks_assistant_fk" FOREIGN KEY ("assistant_id")
        REFERENCES "assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Identical text is stored once per assistant: dedupes pages that repeat
-- boilerplate, and makes re-sync idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_assistant_hash_key"
    ON "knowledge_chunks"("assistant_id", "content_hash");
-- EVERY similarity query filters by assistant_id first; this index is what keeps
-- one assistant's knowledge from ever being scanned for another's.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_assistant_idx"
    ON "knowledge_chunks"("assistant_id");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_source_idx"
    ON "knowledge_chunks"("source_id");
