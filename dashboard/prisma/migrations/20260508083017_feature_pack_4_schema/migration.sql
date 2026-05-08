/*
  Warnings:

  - The `role` column on the `users` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "DndSource" AS ENUM ('MANUAL', 'CALLER_REQUEST', 'CSV_IMPORT', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'RETRY_SCHEDULED', 'DEAD_LETTER');

-- AlterEnum
ALTER TYPE "CallOutcome" ADD VALUE 'OPT_OUT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignTargetStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "CampaignTargetStatus" ADD VALUE 'DEFERRED';

-- AlterTable
ALTER TABLE "assistants" ADD COLUMN     "recordingConsentMessage" TEXT,
ADD COLUMN     "redactionEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "transcriptHasPii" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "campaign_targets" ADD COLUMN     "dispatchAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "quietHoursEnd" TEXT DEFAULT '21:00',
ADD COLUMN     "quietHoursStart" TEXT DEFAULT '09:00',
ADD COLUMN     "quietHoursTimezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "recordingDefaultConsentMessage" TEXT DEFAULT 'This call may be recorded for quality and training purposes.';

-- AlterTable
ALTER TABLE "transcript_messages" ADD COLUMN     "contentRedacted" TEXT,
ADD COLUMN     "hasPii" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "invitedBy" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- Safely migrate users.role from text → UserRole enum
-- Step 1: drop the existing text default so ALTER TYPE doesn't fail
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
-- Step 2: promote existing admin/member/NULL rows to OWNER before the type change
UPDATE "users" SET "role" = 'OWNER' WHERE "role" IN ('admin', 'member') OR "role" IS NULL;
-- Step 3: cast the column to the new enum type
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
-- Step 4: set the new enum default
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dnd_numbers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "reason" TEXT,
    "source" "DndSource" NOT NULL,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dnd_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- CreateIndex
CREATE INDEX "invites_organizationId_idx" ON "invites"("organizationId");

-- CreateIndex
CREATE INDEX "invites_email_idx" ON "invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "dnd_numbers_organizationId_idx" ON "dnd_numbers"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "dnd_numbers_organizationId_phoneE164_key" ON "dnd_numbers"("organizationId", "phoneE164");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_organizationId_scope_key_key" ON "idempotency_keys"("organizationId", "scope", "key");

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dnd_numbers" ADD CONSTRAINT "dnd_numbers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
