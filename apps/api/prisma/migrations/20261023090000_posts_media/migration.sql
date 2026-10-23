BEGIN;

-- Posts with one private image, and avatars (FR-02/03/04).
-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('POST', 'AVATAR');

-- CreateEnum
CREATE TYPE "MediaState" AS ENUM ('PENDING', 'READY', 'DELETED');

-- AlterTable
ALTER TABLE "auth_users" ADD COLUMN     "avatarMediaId" UUID;

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "state" "MediaState" NOT NULL DEFAULT 'PENDING',
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id"),
    -- READY media has its decoded size; DELETED media, and only it, has deletedAt.
    CONSTRAINT "media_state_check" CHECK (
      ("state" <> 'READY' OR ("width" > 0 AND "height" > 0))
      AND (("state" = 'DELETED') = ("deletedAt" IS NOT NULL))
    )
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "authorId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "caption" VARCHAR(2200) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_state_createdAt_idx" ON "media"("state", "createdAt");

-- CreateIndex
CREATE INDEX "media_ownerId_idx" ON "media"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "posts_mediaId_key" ON "posts"("mediaId");

-- CreateIndex
CREATE INDEX "posts_authorId_createdAt_id_idx" ON "posts"("authorId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_avatarMediaId_key" ON "auth_users"("avatarMediaId");

-- AddForeignKey
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE NO ACTION ON UPDATE RESTRICT;

COMMIT;
