ALTER TABLE "comments" DROP CONSTRAINT "comments_text_not_blank";
ALTER TABLE "comments" ADD CONSTRAINT "comments_text_not_blank" CHECK ("mediaId" IS NOT NULL OR "text" ~ '\S');
