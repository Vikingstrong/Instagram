CREATE TYPE "SharedContentKind" AS ENUM ('POST','REEL','STORY');
ALTER TABLE "direct_messages" ADD COLUMN "sharedKind" "SharedContentKind", ADD COLUMN "sharedTargetId" UUID, ADD COLUMN "sharedPostId" UUID, ADD COLUMN "sharedStoryId" UUID;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sharedPostId_fkey" FOREIGN KEY ("sharedPostId") REFERENCES posts(id) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sharedStoryId_fkey" FOREIGN KEY ("sharedStoryId") REFERENCES stories(id) ON DELETE SET NULL ON UPDATE RESTRICT;
CREATE INDEX "direct_messages_sharedPostId_idx" ON "direct_messages"("sharedPostId");
CREATE INDEX "direct_messages_sharedStoryId_idx" ON "direct_messages"("sharedStoryId");
ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_text_not_blank";
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_text_not_blank" CHECK ("mediaId" IS NOT NULL OR "sharedKind" IS NOT NULL OR "text" ~ '\S');
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_shared_shape" CHECK (
  ("sharedKind" IS NULL AND "sharedTargetId" IS NULL AND "sharedPostId" IS NULL AND "sharedStoryId" IS NULL)
  OR ("sharedKind" IS NOT NULL AND "sharedTargetId" IS NOT NULL AND "mediaId" IS NULL AND "sourceHash" IS NULL
      AND CASE WHEN "sharedKind" = 'STORY' THEN ("sharedPostId" IS NULL AND ("sharedStoryId" IS NULL OR "sharedStoryId" = "sharedTargetId"))
        ELSE ("sharedStoryId" IS NULL AND ("sharedPostId" IS NULL OR "sharedPostId" = "sharedTargetId")) END)
);
CREATE TABLE post_shares (
  "postId" UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "userId" UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("postId","userId")
);
CREATE INDEX "post_shares_userId_idx" ON post_shares("userId");
CREATE TABLE story_shares (
  "storyId" UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "userId" UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("storyId","userId")
);
CREATE INDEX "story_shares_userId_idx" ON story_shares("userId");
