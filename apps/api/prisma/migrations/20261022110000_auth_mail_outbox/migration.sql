BEGIN;
CREATE TABLE "mail_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tokenId" UUID NOT NULL,
  "payload" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMPTZ(3),
  "claimId" UUID,
  "sentAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mail_deliveries_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "auth_tokens"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "mail_deliveries_state_check" CHECK (
    "attempts" >= 0 AND NOT ("sentAt" IS NOT NULL AND "cancelledAt" IS NOT NULL)
    AND (("sentAt" IS NULL AND "cancelledAt" IS NULL AND "payload" IS NOT NULL)
      OR (("sentAt" IS NOT NULL OR "cancelledAt" IS NOT NULL) AND "payload" IS NULL))
    AND (("claimId" IS NULL) = ("leaseUntil" IS NULL))
  )
);
CREATE UNIQUE INDEX "mail_deliveries_tokenId_key" ON "mail_deliveries"("tokenId");
CREATE INDEX "mail_deliveries_sentAt_cancelledAt_nextAttemptAt_idx" ON "mail_deliveries"("sentAt", "cancelledAt", "nextAttemptAt");
COMMIT;
