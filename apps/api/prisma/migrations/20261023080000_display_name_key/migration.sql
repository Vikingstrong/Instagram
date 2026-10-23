BEGIN;

-- Case-insensitive search key for display names. The API writes it with
-- Unicode lower case; a "C" collation lower() folds only ASCII, so existing
-- rows are backfilled through ICU when the server provides it.
ALTER TABLE "auth_users" ADD COLUMN "displayNameKey" TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') THEN
    UPDATE "auth_users" SET "displayNameKey" = lower("displayName" COLLATE "und-x-icu");
  ELSE
    UPDATE "auth_users" SET "displayNameKey" = lower("displayName");
  END IF;
END $$;

COMMIT;
