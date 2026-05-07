-- CreateEnum
CREATE TYPE "SpeechSensitivity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "assistants" ADD COLUMN     "backgroundDenoising" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "confidenceThresholdPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "endOfSpeechSensitivity" "SpeechSensitivity" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "hallucinationGuard" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "interruptionThresholdMs" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "minPauseMs" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "voicemailDetection" BOOLEAN NOT NULL DEFAULT false;
