-- A new enum value is committed before use (PostgreSQL requirement).
ALTER TYPE "MediaKind" ADD VALUE 'STORY';
BEGIN;
CREATE TABLE "stories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "authorId" UUID NOT NULL,
  "mediaId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
  CONSTRAINT "stories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stories_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "stories_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "stories_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE NO ACTION ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "stories_mediaId_key" ON "stories"("mediaId");
CREATE INDEX "stories_authorId_createdAt_id_idx" ON "stories"("authorId", "createdAt", "id");
CREATE INDEX "stories_expiresAt_idx" ON "stories"("expiresAt");
CREATE TABLE "story_views" (
  "storyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "viewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_views_pkey" PRIMARY KEY ("storyId", "userId"),
  CONSTRAINT "story_views_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "story_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "story_views_storyId_viewedAt_userId_idx" ON "story_views"("storyId", "viewedAt" DESC, "userId" DESC);
CREATE INDEX "story_views_userId_idx" ON "story_views"("userId");
COMMIT;
