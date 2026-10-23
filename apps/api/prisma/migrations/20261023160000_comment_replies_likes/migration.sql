BEGIN;
ALTER TABLE "comments" ADD COLUMN "parentId" UUID, ADD COLUMN "replyToUserId" UUID;
ALTER TABLE "comments" ADD CONSTRAINT "comments_id_postId_key" UNIQUE ("id", "postId");
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_post_fkey" FOREIGN KEY ("parentId", "postId") REFERENCES "comments"("id", "postId") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "comments" ADD CONSTRAINT "comments_replyToUserId_fkey" FOREIGN KEY ("replyToUserId") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "comments" ADD CONSTRAINT "comments_root_recipient_check" CHECK ("parentId" IS NOT NULL OR "replyToUserId" IS NULL);
CREATE INDEX "comments_parentId_createdAt_id_idx" ON "comments"("parentId", "createdAt", "id");
-- Replies always belong to a root in the same post; the composite FK checks the post.
CREATE FUNCTION enforce_comment_reply_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND EXISTS (SELECT 1 FROM "comments" WHERE "id" = NEW."parentId" AND "parentId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Replies must reference a root comment' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."postId" IS DISTINCT FROM OLD."postId" OR NEW."replyToUserId" IS DISTINCT FROM OLD."replyToUserId" AND NEW."replyToUserId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Reply destination is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "comments_reply_depth" BEFORE INSERT OR UPDATE ON "comments" FOR EACH ROW EXECUTE FUNCTION enforce_comment_reply_depth();
CREATE TABLE "comment_likes" (
  "commentId" UUID NOT NULL REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  "userId" UUID NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("commentId", "userId")
);
CREATE INDEX "comment_likes_userId_idx" ON "comment_likes"("userId");
COMMIT;
