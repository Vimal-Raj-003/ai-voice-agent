-- pg_trgm extension + GIN trigram index on transcript_messages.content
-- Powers the substring/fuzzy transcript search on the /calls page (Task 11).
--
-- NOTE: CONCURRENTLY is intentionally omitted — Prisma's shadow-database
-- validation wraps migrations in a transaction and CREATE INDEX CONCURRENTLY
-- can't run inside a tx. For a small or freshly seeded table the brief
-- AccessExclusiveLock during a non-concurrent build is acceptable. On a
-- production DB with a large transcript_messages table, build the index
-- out-of-band with CONCURRENTLY first, then ship this no-op migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_transcript_content_trgm
  ON transcript_messages USING gin (content gin_trgm_ops);
