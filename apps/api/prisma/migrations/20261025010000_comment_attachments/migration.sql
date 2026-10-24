ALTER TYPE "MediaKind" ADD VALUE 'COMMENT';
ALTER TABLE "comments" ADD COLUMN "mediaId" UUID;
CREATE UNIQUE INDEX "comments_mediaId_key" ON "comments"("mediaId");
ALTER TABLE "comments" ADD CONSTRAINT "comments_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE NO ACTION ON UPDATE RESTRICT;
