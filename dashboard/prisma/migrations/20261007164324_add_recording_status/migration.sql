-- Additive, non-destructive: private call-recording fields on the existing calls table.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingStatus" TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingObjectKey" TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingEgressId" TEXT;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingDurationSeconds" INTEGER;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recordingError" TEXT;
