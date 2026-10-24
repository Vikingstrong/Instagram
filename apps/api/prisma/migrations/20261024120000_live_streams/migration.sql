BEGIN;

-- Live streams (FR-12): state of each stream and its chat while on air.
-- CreateEnum
CREATE TYPE "LiveStatus" AS ENUM ('LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "LiveEndReason" AS ENUM ('HOST', 'LOST', 'SIGNED_OUT', 'TIME_LIMIT');

-- CreateTable
CREATE TABLE "lives" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "activeHostId" UUID,
    "hostSessionHash" VARCHAR(64) NOT NULL,
    "hostClientId" UUID NOT NULL,
    "status" "LiveStatus" NOT NULL DEFAULT 'LIVE',
    "endReason" "LiveEndReason",
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "hostSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_comments" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "text" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lives_activeHostId_key" ON "lives"("activeHostId");

-- CreateIndex
CREATE INDEX "lives_status_startedAt_idx" ON "lives"("status", "startedAt");

-- CreateIndex
CREATE INDEX "lives_hostId_startedAt_idx" ON "lives"("hostId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "live_comments_liveId_createdAt_id_idx" ON "live_comments"("liveId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "live_comments_authorId_idx" ON "live_comments"("authorId");

-- AddForeignKey
ALTER TABLE "lives" ADD CONSTRAINT "lives_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "lives"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- CheckConstraint
-- activeHostId marks the one live stream of a host that is on air; an ended
-- stream keeps its end time and reason.
ALTER TABLE "lives" ADD CONSTRAINT "lives_state_check" CHECK (
  ("activeHostId" IS NULL OR "activeHostId" = "hostId")
  AND (("status" = 'LIVE') = ("activeHostId" IS NOT NULL))
  AND (("status" = 'LIVE') = ("endedAt" IS NULL))
  AND (("status" = 'LIVE') = ("endReason" IS NULL))
);

COMMIT;
