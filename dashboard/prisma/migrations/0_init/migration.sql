-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."CallStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."CampaignTargetStatus" AS ENUM ('PENDING', 'DISPATCHED', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."EndedReason" AS ENUM ('CUSTOMER_HANGUP', 'ASSISTANT_HANGUP', 'TRANSFERRED', 'PIPELINE_ERROR', 'SILENCE_TIMEOUT', 'EXCEEDED_MAX_DURATION', 'VOICEMAIL', 'NO_ANSWER', 'BUSY', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."LlmProvider" AS ENUM ('OPENAI', 'GROQ', 'OPENROUTER', 'ANTHROPIC', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."SttProvider" AS ENUM ('DEEPGRAM', 'OPENAI', 'SARVAM');

-- CreateEnum
CREATE TYPE "public"."TranscriptRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "public"."TrunkType" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."TtsProvider" AS ENUM ('OPENAI', 'DEEPGRAM', 'SARVAM', 'CARTESIA', 'ELEVENLABS');

-- CreateEnum
CREATE TYPE "public"."WebhookEvent" AS ENUM ('CALL_STARTED', 'CALL_ENDED', 'CALL_FAILED', 'TRANSCRIPT_UPDATE', 'TRANSFER_INITIATED');

-- CreateTable
CREATE TABLE "public"."api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assistant_tools" (
    "assistantId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,

    CONSTRAINT "assistant_tools_pkey" PRIMARY KEY ("assistantId","toolId")
);

-- CreateTable
CREATE TABLE "public"."assistants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "firstMessage" TEXT,
    "endCallMessage" TEXT,
    "llmProvider" "public"."LlmProvider" NOT NULL DEFAULT 'OPENAI',
    "llmModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER,
    "sttProvider" "public"."SttProvider" NOT NULL DEFAULT 'DEEPGRAM',
    "sttModel" TEXT NOT NULL DEFAULT 'nova-2',
    "sttLanguage" TEXT NOT NULL DEFAULT 'en',
    "ttsProvider" "public"."TtsProvider" NOT NULL DEFAULT 'DEEPGRAM',
    "ttsModel" TEXT,
    "voiceId" TEXT,
    "silenceTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "maxDurationSeconds" INTEGER NOT NULL DEFAULT 1800,
    "endCallPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backgroundSound" TEXT,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hipaaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."calls" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assistantId" TEXT,
    "phoneNumberId" TEXT,
    "campaignId" TEXT,
    "livekitRoomName" TEXT,
    "livekitCallId" TEXT,
    "sipCallId" TEXT,
    "dispatchId" TEXT,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "direction" "public"."CallDirection" NOT NULL,
    "status" "public"."CallStatus" NOT NULL DEFAULT 'QUEUED',
    "endedReason" "public"."EndedReason",
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "costUsd" DECIMAL(10,6),
    "recordingUrl" TEXT,
    "summary" TEXT,
    "modelProviderUsed" TEXT,
    "voiceUsed" TEXT,
    "promptOverride" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_targets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "public"."CampaignTargetStatus" NOT NULL DEFAULT 'PENDING',
    "callId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "variables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assistantId" TEXT,
    "name" TEXT NOT NULL,
    "prompt" TEXT,
    "status" "public"."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "totalTargets" INTEGER NOT NULL DEFAULT 0,
    "dispatchedTargets" INTEGER NOT NULL DEFAULT 0,
    "failedTargets" INTEGER NOT NULL DEFAULT 0,
    "completedTargets" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."phone_numbers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'vobiz',
    "trunkId" TEXT,
    "assistantId" TEXT,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sip_trunks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'vobiz',
    "type" "public"."TrunkType" NOT NULL,
    "name" TEXT NOT NULL,
    "livekitTrunkId" TEXT NOT NULL,
    "sipDomain" TEXT,
    "sipUsername" TEXT,
    "sipPassword" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sip_trunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tool_invocations" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "toolId" TEXT,
    "toolName" TEXT NOT NULL,
    "arguments" JSONB,
    "result" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tools" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parameters" JSONB NOT NULL,
    "serverUrl" TEXT,
    "serverSecret" TEXT,
    "builtin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."transcript_messages" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "role" "public"."TranscriptRole" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,

    CONSTRAINT "transcript_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "callId" TEXT,
    "event" "public"."WebhookEvent" NOT NULL,
    "payload" JSONB NOT NULL,
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhooks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "events" "public"."WebhookEvent"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "public"."api_keys"("keyHash" ASC);

-- CreateIndex
CREATE INDEX "api_keys_organizationId_idx" ON "public"."api_keys"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "assistants_organizationId_idx" ON "public"."assistants"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "calls_assistantId_idx" ON "public"."calls"("assistantId" ASC);

-- CreateIndex
CREATE INDEX "calls_campaignId_idx" ON "public"."calls"("campaignId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "calls_livekitCallId_key" ON "public"."calls"("livekitCallId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "calls_livekitRoomName_key" ON "public"."calls"("livekitRoomName" ASC);

-- CreateIndex
CREATE INDEX "calls_organizationId_createdAt_idx" ON "public"."calls"("organizationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "calls_sipCallId_key" ON "public"."calls"("sipCallId" ASC);

-- CreateIndex
CREATE INDEX "calls_status_idx" ON "public"."calls"("status" ASC);

-- CreateIndex
CREATE INDEX "calls_toNumber_idx" ON "public"."calls"("toNumber" ASC);

-- CreateIndex
CREATE INDEX "campaign_targets_campaignId_status_idx" ON "public"."campaign_targets"("campaignId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "campaigns_organizationId_idx" ON "public"."campaigns"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "public"."organizations"("slug" ASC);

-- CreateIndex
CREATE INDEX "phone_numbers_assistantId_idx" ON "public"."phone_numbers"("assistantId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_number_key" ON "public"."phone_numbers"("number" ASC);

-- CreateIndex
CREATE INDEX "phone_numbers_organizationId_idx" ON "public"."phone_numbers"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sip_trunks_livekitTrunkId_key" ON "public"."sip_trunks"("livekitTrunkId" ASC);

-- CreateIndex
CREATE INDEX "sip_trunks_organizationId_idx" ON "public"."sip_trunks"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "tool_invocations_callId_idx" ON "public"."tool_invocations"("callId" ASC);

-- CreateIndex
CREATE INDEX "tools_organizationId_idx" ON "public"."tools"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tools_organizationId_name_key" ON "public"."tools"("organizationId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "transcript_messages_callId_timestamp_idx" ON "public"."transcript_messages"("callId" ASC, "timestamp" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "public"."users"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_createdAt_idx" ON "public"."webhook_deliveries"("webhookId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "webhooks_organizationId_idx" ON "public"."webhooks"("organizationId" ASC);

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assistant_tools" ADD CONSTRAINT "assistant_tools_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "public"."assistants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assistant_tools" ADD CONSTRAINT "assistant_tools_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "public"."tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assistants" ADD CONSTRAINT "assistants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."calls" ADD CONSTRAINT "calls_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "public"."assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."calls" ADD CONSTRAINT "calls_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."calls" ADD CONSTRAINT "calls_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."calls" ADD CONSTRAINT "calls_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "public"."phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_targets" ADD CONSTRAINT "campaign_targets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaigns" ADD CONSTRAINT "campaigns_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "public"."assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaigns" ADD CONSTRAINT "campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."phone_numbers" ADD CONSTRAINT "phone_numbers_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "public"."assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."phone_numbers" ADD CONSTRAINT "phone_numbers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."phone_numbers" ADD CONSTRAINT "phone_numbers_trunkId_fkey" FOREIGN KEY ("trunkId") REFERENCES "public"."sip_trunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sip_trunks" ADD CONSTRAINT "sip_trunks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_callId_fkey" FOREIGN KEY ("callId") REFERENCES "public"."calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "public"."tools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tools" ADD CONSTRAINT "tools_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."transcript_messages" ADD CONSTRAINT "transcript_messages_callId_fkey" FOREIGN KEY ("callId") REFERENCES "public"."calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_callId_fkey" FOREIGN KEY ("callId") REFERENCES "public"."calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "public"."webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhooks" ADD CONSTRAINT "webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

