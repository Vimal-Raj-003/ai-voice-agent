-- Parallel campaign dialing: per-campaign limits + atomic target claiming.
--
-- Minimal and backward compatible: all columns are nullable or defaulted, so
-- existing campaigns and targets keep working unchanged. No enum changes (a new
-- CampaignTargetStatus value would need ADD VALUE and a separate transaction);
-- the claim is expressed with a timestamp instead, which is reclaimable.
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "maxConcurrent"      INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "maxStartsPerMinute" INTEGER NOT NULL DEFAULT 10;

-- attemptId: one id per dial attempt, so a retry is distinguishable from a
--            duplicate and a dispatch can be made idempotent.
-- claimedAt: set the instant a dispatcher wins the row. A claim older than the
--            reclaim window is treated as abandoned (process crashed), which is
--            what makes restart recovery work without double-dialing.
ALTER TABLE "campaign_targets"
  ADD COLUMN IF NOT EXISTS "attemptId" TEXT,
  ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

-- The claim query filters on (campaignId, status, claimedAt) and orders by id.
CREATE INDEX IF NOT EXISTS "campaign_targets_claim_idx"
  ON "campaign_targets" ("campaignId", "status", "claimedAt");

-- Dispatch-rate accounting counts calls created in the last minute.
CREATE INDEX IF NOT EXISTS "calls_campaign_created_idx"
  ON "calls" ("campaignId", "createdAt");
