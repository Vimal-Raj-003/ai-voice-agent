-- Additive only. Written by hand instead of `prisma migrate dev` because this
-- database has pre-existing drift (unrelated `webhooks` index/FK), and
-- migrate dev would have required a full reset to proceed.

-- The LlmProvider enum predates Gemini support, so selecting Gemini was
-- impossible even though the worker can serve it.
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'GEMINI';

-- Primary and fallback models are persisted separately; the fallback stays on
-- the selected provider unless ALLOW_CROSS_PROVIDER_FALLBACK=true. NULL means
-- "use the provider's built-in default fallback".
ALTER TABLE "assistants" ADD COLUMN IF NOT EXISTS "llm_fallback_model" TEXT;
