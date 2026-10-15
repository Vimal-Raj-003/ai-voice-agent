-- BYOK provider credentials, one row per (organization, provider).
--
-- Deliberately NOT stored in api_keys: that table holds a one-way hash of a
-- token presented TO the voice-service. These are credentials the worker must
-- present to a third party, so they must be recoverable -> AES-256-GCM
-- ciphertext. Nothing here is ever sent to the browser in plaintext.
CREATE TABLE IF NOT EXISTS "provider_credentials" (
    "id"              TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider"        TEXT NOT NULL,
    "ciphertext"      TEXT NOT NULL,
    "hint"            TEXT,
    "last_status"     TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_error"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

-- One credential per provider per tenant; the upsert in the server action
-- relies on this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_organization_id_provider_key"
    ON "provider_credentials" ("organization_id", "provider");

CREATE INDEX IF NOT EXISTS "provider_credentials_organization_id_idx"
    ON "provider_credentials" ("organization_id");

DO $$
BEGIN
    ALTER TABLE "provider_credentials"
        ADD CONSTRAINT "provider_credentials_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
