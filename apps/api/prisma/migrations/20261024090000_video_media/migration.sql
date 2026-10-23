BEGIN;

-- Video posts (FR-10): media type, duration and processing failure.
-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "failedAt" TIMESTAMPTZ(3),
ADD COLUMN     "type" "MediaType" NOT NULL DEFAULT 'IMAGE';


-- CheckConstraint
-- Avatars stay images; only videos have a duration (required once READY);
-- only an unfinished video can be marked as failed.
ALTER TABLE "media" ADD CONSTRAINT "media_video_check" CHECK (
  ("kind" <> 'AVATAR' OR "type" = 'IMAGE')
  AND ("type" = 'VIDEO' OR "durationMs" IS NULL)
  AND ("type" <> 'VIDEO' OR "state" <> 'READY' OR "durationMs" > 0)
  AND ("failedAt" IS NULL OR ("type" = 'VIDEO' AND "state" <> 'READY'))
);

COMMIT;
