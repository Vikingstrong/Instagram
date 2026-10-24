CREATE TYPE "NotificationKind" AS ENUM ('POST_LIKE', 'COMMENT', 'REPLY', 'COMMENT_LIKE');

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "key" VARCHAR(120) NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "recipientId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "commentId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "notifications_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "notifications_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "notifications_other_actor_check" CHECK ("recipientId" <> "actorId"),
  CONSTRAINT "notifications_shape_check" CHECK (
    ("kind" = 'POST_LIKE' AND "commentId" IS NULL) OR
    ("kind" IN ('COMMENT', 'REPLY', 'COMMENT_LIKE') AND "commentId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "notifications_key_key" ON "notifications"("key");
CREATE INDEX "notifications_recipientId_createdAt_id_idx" ON "notifications"("recipientId", "createdAt" DESC, "id" DESC);
CREATE INDEX "notifications_postId_idx" ON "notifications"("postId");
CREATE INDEX "notifications_commentId_idx" ON "notifications"("commentId");
