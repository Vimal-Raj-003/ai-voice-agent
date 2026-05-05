-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('BOOKED', 'NOT_INTERESTED', 'WRONG_NUMBER', 'VOICEMAIL', 'NO_ANSWER', 'CALLBACK_REQUESTED', 'TRANSFERRED', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('ONCE', 'DAILY', 'WEEKDAYS');

-- CreateEnum
CREATE TYPE "ErrorLevel" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "caller_history_loaded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interrupt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "outcome" "CallOutcome",
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "sentiment" TEXT,
ADD COLUMN     "was_booked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "agent_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voice" TEXT NOT NULL DEFAULT 'Aoede',
    "model" TEXT NOT NULL DEFAULT 'gemini-3.1-flash-live-preview',
    "system_prompt" TEXT,
    "enabled_tools" TEXT NOT NULL DEFAULT '[]',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "last_call_at" TIMESTAMP(3),
    "last_outcome" TEXT,
    "is_booked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_memory" (
    "id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "insight" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "email" TEXT,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "calcom_booking_uid" TEXT,
    "gcal_event_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "level" "ErrorLevel" NOT NULL DEFAULT 'ERROR',
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_calls" (
    "room_id" TEXT NOT NULL,
    "phone_number" TEXT,
    "caller_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_calls_pkey" PRIMARY KEY ("room_id")
);

-- CreateIndex
CREATE INDEX "agent_profiles_is_default_idx" ON "agent_profiles"("is_default");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_phone_number_key" ON "contacts"("phone_number");

-- CreateIndex
CREATE INDEX "contact_memory_phone_number_created_at_idx" ON "contact_memory"("phone_number", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_booking_id_key" ON "appointments"("booking_id");

-- CreateIndex
CREATE INDEX "appointments_date_time_idx" ON "appointments"("date", "time");

-- CreateIndex
CREATE INDEX "appointments_phone_number_idx" ON "appointments"("phone_number");

-- CreateIndex
CREATE INDEX "error_logs_timestamp_idx" ON "error_logs"("timestamp");

-- CreateIndex
CREATE INDEX "error_logs_source_level_idx" ON "error_logs"("source", "level");

-- CreateIndex
CREATE INDEX "calls_toNumber_createdAt_idx" ON "calls"("toNumber", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_memory" ADD CONSTRAINT "contact_memory_phone_number_fkey" FOREIGN KEY ("phone_number") REFERENCES "contacts"("phone_number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_phone_number_fkey" FOREIGN KEY ("phone_number") REFERENCES "contacts"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;
