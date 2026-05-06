-- AlterTable
ALTER TABLE "campaign_targets" ADD COLUMN     "dispatchId" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "leadName" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "agentProfileId" TEXT,
ADD COLUMN     "callDelaySeconds" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "scheduleTime" TEXT,
ADD COLUMN     "scheduleType" "ScheduleType";
