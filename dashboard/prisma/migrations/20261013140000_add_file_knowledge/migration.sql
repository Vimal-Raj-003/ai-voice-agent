-- File knowledge reuses the EXISTING knowledge_sources / knowledge_chunks
-- tables and the same pgvector index. No new vector store.
-- The existing `type` column already carries 'URL'; it now also carries
-- 'PDF' | 'IMAGE' | 'DOCUMENT'. Additive only.

ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "file_name"  TEXT;
-- Path on disk under KNOWLEDGE_FILES_DIR. Stored rather than the raw upload
-- name so a crafted filename can never escape the directory.
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "file_path"  TEXT;
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "mime_type"  TEXT;
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "file_size"  INTEGER;
-- sha256 of the uploaded bytes: re-uploading the same file re-uses its record
-- instead of indexing it twice.
ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "file_hash"  TEXT;

CREATE INDEX IF NOT EXISTS "knowledge_sources_type_idx"
    ON "knowledge_sources"("assistant_id", "type");

-- A URL is unique per assistant, but several files can share the placeholder
-- url value, so uniqueness for files is by content hash instead.
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_sources_assistant_filehash_key"
    ON "knowledge_sources"("assistant_id", "file_hash") WHERE "file_hash" IS NOT NULL;
