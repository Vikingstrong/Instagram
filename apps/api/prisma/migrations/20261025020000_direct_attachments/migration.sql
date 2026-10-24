ALTER TYPE "MediaKind" ADD VALUE 'DIRECT';
ALTER TYPE "MediaType" ADD VALUE 'AUDIO';
ALTER TABLE "direct_messages" ADD COLUMN "mediaId" UUID, ADD COLUMN "sourceHash" VARCHAR(64);
CREATE UNIQUE INDEX "direct_messages_mediaId_key" ON "direct_messages"("mediaId");
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE NO ACTION ON UPDATE RESTRICT;
ALTER TABLE "direct_messages" DROP CONSTRAINT "direct_messages_text_not_blank";
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_text_not_blank" CHECK ("mediaId" IS NOT NULL OR "text" ~ '\S');
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_attachment_hash" CHECK (("mediaId" IS NULL AND "sourceHash" IS NULL) OR ("mediaId" IS NOT NULL AND "sourceHash" IS NOT NULL AND "sourceHash" ~ '^[0-9a-f]{64}$'));
