BEGIN;

-- Text profile fields (FR-02/03). Avatar arrives with private media (stage 4).
ALTER TABLE "auth_users"
  ADD COLUMN "displayName" VARCHAR(30) NOT NULL DEFAULT '',
  ADD COLUMN "bio" VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "FollowStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateTable
CREATE TABLE "follows" (
    "followerId" UUID NOT NULL,
    "followeeId" UUID NOT NULL,
    "status" "FollowStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(3),

    CONSTRAINT "follows_pkey" PRIMARY KEY ("followerId", "followeeId"),
    CONSTRAINT "follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "follows_followeeId_fkey" FOREIGN KEY ("followeeId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "follows_not_self_check" CHECK ("followerId" <> "followeeId"),
    CONSTRAINT "follows_accepted_check" CHECK (("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "follows_followeeId_status_idx" ON "follows"("followeeId", "status");
CREATE INDEX "follows_followerId_status_idx" ON "follows"("followerId", "status");

COMMIT;
