-- Let the provider enums hold every provider the registry can actually build.
--
-- Without these the dashboard could OFFER a provider it was then unable to
-- save: the dropdown is registry-driven, but assistants.sttProvider /
-- ttsProvider are Postgres enums, so an unlisted value fails on write.
-- GEMINI was already in this position — TTS could run on Gemini but no
-- assistant could be saved with it.
--
-- ADD VALUE IF NOT EXISTS is idempotent, so re-running this is safe.
ALTER TYPE "TtsProvider" ADD VALUE IF NOT EXISTS 'GEMINI';
ALTER TYPE "TtsProvider" ADD VALUE IF NOT EXISTS 'RUMIK';
ALTER TYPE "TtsProvider" ADD VALUE IF NOT EXISTS 'MURF';

ALTER TYPE "SttProvider" ADD VALUE IF NOT EXISTS 'GOOGLE';
ALTER TYPE "SttProvider" ADD VALUE IF NOT EXISTS 'CARTESIA';
ALTER TYPE "SttProvider" ADD VALUE IF NOT EXISTS 'ELEVENLABS';
