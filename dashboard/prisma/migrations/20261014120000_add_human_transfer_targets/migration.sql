-- Intent-based human call forwarding: one destination per category, per assistant.
--
-- Kept out of sip_trunks / phone_numbers on purpose. Those describe the Vobiz
-- DID and trunk that CARRY calls; these are hand-off destinations chosen by what
-- the caller is asking about. Editing a forwarding number must never be able to
-- disturb telephony config.
CREATE TABLE IF NOT EXISTS "human_transfer_targets" (
    "id"           TEXT NOT NULL,
    "assistant_id" TEXT NOT NULL,
    "category"     TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "phone_e164"   TEXT,
    "enabled"      BOOLEAN NOT NULL DEFAULT true,
    "priority"     INTEGER NOT NULL DEFAULT 100,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "human_transfer_targets_pkey" PRIMARY KEY ("id")
);

-- One row per category per assistant; the upsert in the server action relies on
-- this, and it is what caps an assistant at the four supported categories.
CREATE UNIQUE INDEX IF NOT EXISTS "human_transfer_targets_assistant_category_key"
    ON "human_transfer_targets" ("assistant_id", "category");
CREATE INDEX IF NOT EXISTS "human_transfer_targets_assistant_idx"
    ON "human_transfer_targets" ("assistant_id");

DO $$
BEGIN
    ALTER TABLE "human_transfer_targets"
        ADD CONSTRAINT "human_transfer_targets_assistant_id_fkey"
        FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Only the four supported categories may ever be stored.
DO $$
BEGIN
    ALTER TABLE "human_transfer_targets"
        ADD CONSTRAINT "human_transfer_targets_category_check"
        CHECK ("category" IN ('software', 'marketing', 'content', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
