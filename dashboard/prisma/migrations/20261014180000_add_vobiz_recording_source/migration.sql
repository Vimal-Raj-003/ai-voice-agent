-- Vobiz as the PRIMARY recording source (local recorder kept as fallback).
--
-- Reuses the existing columns wherever one already fits:
--   "sipCallId"                -> the SIP Call-ID (LiveKit `sip.callIDFull`), which
--                                 is the deterministic join key to Vobiz CDR
--                                 (GET /cdr?sip_call_id=...). Column already exists.
--   "telephonyProvider"        -> already written as 'vobiz' by complete_call().
--   "recordingDurationSeconds" -> already exists; filled from the Vobiz recording.
--
-- Only the genuinely new provider-side identifiers are added here. All columns are
-- nullable TEXT so every existing row (and the local-recording playback path that
-- depends on "recordingObjectKey") keeps working untouched.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "providerCallId"          TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "providerRecordingId"     TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "providerRecordingStatus" TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "providerRecordingUrl"    TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingSource"         TEXT;

-- Webhook delivery looks a call up by the provider's identifiers, so both need an
-- index. Neither is UNIQUE: a retried/duplicated provider event must not be able
-- to fail an insert, and one Vobiz call can in principle yield more than one
-- recording.
CREATE INDEX IF NOT EXISTS "calls_providerCallId_idx"      ON "calls" ("providerCallId");
CREATE INDEX IF NOT EXISTS "calls_providerRecordingId_idx" ON "calls" ("providerRecordingId");
