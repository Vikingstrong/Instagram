-- Preserve image/video invariants while allowing decoded voice duration.
ALTER TABLE "media" DROP CONSTRAINT "media_video_check";
ALTER TABLE "media" ADD CONSTRAINT "media_video_check" CHECK (
  ("kind" <> 'AVATAR' OR "type" = 'IMAGE')
  AND ("type" IN ('VIDEO', 'AUDIO') OR "durationMs" IS NULL)
  AND ("type" <> 'VIDEO' OR "state" <> 'READY' OR "durationMs" > 0)
  AND ("failedAt" IS NULL OR ("type" = 'VIDEO' AND "state" <> 'READY'))
  AND ("type" <> 'AUDIO' OR "kind" = 'DIRECT')
  AND ("kind" <> 'COMMENT' OR "type" = 'IMAGE')
);
