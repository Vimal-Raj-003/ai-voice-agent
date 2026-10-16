-- Complete the appointment record for full booking management.
--
-- Strictly ADDITIVE and idempotent: every column is defaulted or nullable, so
-- the existing rows keep working unchanged and nothing is rewritten. No column
-- is dropped, renamed or retyped, and no data is deleted.
ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "duration_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "timezone"         TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  -- Assigned host / assistant. Free text so it can hold either an assistant
  -- name or a human staff member, matching how `service` is already stored.
  ADD COLUMN IF NOT EXISTS "host"             TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at"       TIMESTAMP(3);

-- Backfill updated_at from created_at so existing rows sort sensibly. Touches
-- only rows where the new column is still NULL.
UPDATE "appointments" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

-- Duplicate booking prevention, enforced by the database rather than only in
-- application code: the same customer cannot hold two ACTIVE bookings in the
-- same slot. Partial, so cancelled/completed history is unaffected and a
-- customer may rebook the same slot after cancelling.
-- Verified before creating: no existing group violates this.
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_active_customer_slot_idx"
  ON "appointments" ("phone_number", "date", "time")
  WHERE "status" = 'BOOKED';

-- Conflicting bookings for the same resource: one host cannot be booked twice
-- in the same slot. Partial and NULL-tolerant, so unassigned bookings (host
-- IS NULL) are never constrained.
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_active_host_slot_idx"
  ON "appointments" ("host", "date", "time")
  WHERE "status" = 'BOOKED' AND "host" IS NOT NULL;

-- The calendar lists a month and filters by status; this covers that path.
CREATE INDEX IF NOT EXISTS "appointments_date_status_idx"
  ON "appointments" ("date", "status");
