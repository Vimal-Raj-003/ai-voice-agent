-- CreateEnum
CREATE TYPE "RateKind" AS ENUM ('LLM_INPUT_MTOK', 'LLM_OUTPUT_MTOK', 'STT_MINUTE', 'TTS_KCHARS', 'TELEPHONY_MINUTE');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('OPENROUTER', 'MANUAL', 'DEFAULT');

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "llm_input_tokens" INTEGER,
ADD COLUMN     "llm_output_tokens" INTEGER,
ADD COLUMN     "llm_provider_used" TEXT,
ADD COLUMN     "llm_sku_used" TEXT,
ADD COLUMN     "stt_provider_used" TEXT,
ADD COLUMN     "stt_seconds" INTEGER,
ADD COLUMN     "stt_sku_used" TEXT,
ADD COLUMN     "telephony_provider" TEXT,
ADD COLUMN     "tts_chars" INTEGER,
ADD COLUMN     "tts_provider_used" TEXT,
ADD COLUMN     "tts_sku_used" TEXT;

-- CreateTable
CREATE TABLE "provider_rates" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "kind" "RateKind" NOT NULL,
    "rateUsd" DECIMAL(14,8) NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_rates_provider_kind_idx" ON "provider_rates"("provider", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "provider_rates_provider_sku_kind_key" ON "provider_rates"("provider", "sku", "kind");
