ALTER TABLE "media" DROP CONSTRAINT "media_state_check";
ALTER TABLE "media" ADD CONSTRAINT "media_state_check" CHECK (
  ("state" <> 'READY' OR CASE WHEN "type" = 'AUDIO' THEN ("durationMs" IS NOT NULL AND "durationMs" > 0 AND "durationMs" <= 180000) ELSE ("width" IS NOT NULL AND "height" IS NOT NULL AND "width" > 0 AND "height" > 0) END)
  AND (("state" = 'DELETED') = ("deletedAt" IS NOT NULL))
);
