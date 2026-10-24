BEGIN;

-- Moderation of a host's live streams: moderators and user restrictions.
-- CreateEnum
CREATE TYPE "LiveRestrictionKind" AS ENUM ('MUTE', 'BAN');

-- CreateTable
CREATE TABLE "live_moderators" (
    "hostId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_moderators_pkey" PRIMARY KEY ("hostId","userId")
);

-- CreateTable
CREATE TABLE "live_restrictions" (
    "hostId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "LiveRestrictionKind" NOT NULL,
    "until" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_restrictions_pkey" PRIMARY KEY ("hostId","userId","kind")
);

-- CreateIndex
CREATE INDEX "live_moderators_userId_idx" ON "live_moderators"("userId");

-- CreateIndex
CREATE INDEX "live_restrictions_userId_kind_idx" ON "live_restrictions"("userId", "kind");

-- AddForeignKey
ALTER TABLE "live_moderators" ADD CONSTRAINT "live_moderators_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_moderators" ADD CONSTRAINT "live_moderators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_restrictions" ADD CONSTRAINT "live_restrictions_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_restrictions" ADD CONSTRAINT "live_restrictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_restrictions" ADD CONSTRAINT "live_restrictions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- CheckConstraint
-- Nobody moderates or restricts themselves; a ban has no end.
ALTER TABLE "live_moderators" ADD CONSTRAINT "live_moderators_self_check" CHECK ("hostId" <> "userId");
ALTER TABLE "live_restrictions" ADD CONSTRAINT "live_restrictions_shape_check" CHECK ("hostId" <> "userId" AND ("kind" = 'MUTE' OR "until" IS NULL));

COMMIT;
