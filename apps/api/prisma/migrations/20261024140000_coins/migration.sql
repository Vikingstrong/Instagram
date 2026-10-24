CREATE TYPE "CoinOperationKind" AS ENUM ('DAILY_REWARD', 'GIFT_TRANSFER');
CREATE TABLE "coin_wallets" (
  "userId" UUID NOT NULL PRIMARY KEY,
  "balance" BIGINT NOT NULL DEFAULT 0 CHECK ("balance" >= 0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coin_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE TABLE "coin_operations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "kind" "CoinOperationKind" NOT NULL,
  "senderId" UUID,
  "recipientId" UUID NOT NULL,
  "amount" BIGINT NOT NULL CHECK ("amount" > 0),
  "senderBalanceAfter" BIGINT CHECK ("senderBalanceAfter" >= 0),
  "recipientBalanceAfter" BIGINT NOT NULL CHECK ("recipientBalanceAfter" >= 0),
  "claimDate" DATE,
  "streamId" UUID,
  "giftKey" VARCHAR(80),
  "idempotencyKey" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coin_operations_shape_check" CHECK (
    ("kind" = 'DAILY_REWARD' AND "amount" = 100 AND "senderId" IS NULL AND "senderBalanceAfter" IS NULL AND "claimDate" IS NOT NULL AND "streamId" IS NULL AND "giftKey" IS NULL AND "idempotencyKey" IS NULL)
    OR
    ("kind" = 'GIFT_TRANSFER' AND "senderId" IS NOT NULL AND "senderId" <> "recipientId" AND "senderBalanceAfter" IS NOT NULL AND "claimDate" IS NULL AND "streamId" IS NOT NULL AND "giftKey" IS NOT NULL AND length("giftKey") > 0 AND "idempotencyKey" IS NOT NULL)
  ),
  CONSTRAINT "coin_operations_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "auth_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "coin_operations_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "auth_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "coin_operations_recipientId_claimDate_key" ON "coin_operations"("recipientId", "claimDate");
CREATE UNIQUE INDEX "coin_operations_senderId_idempotencyKey_key" ON "coin_operations"("senderId", "idempotencyKey");
CREATE INDEX "coin_operations_recipientId_createdAt_id_idx" ON "coin_operations"("recipientId", "createdAt" DESC, "id" DESC);
CREATE INDEX "coin_operations_senderId_createdAt_id_idx" ON "coin_operations"("senderId", "createdAt" DESC, "id" DESC);
CREATE INDEX "coin_operations_streamId_idx" ON "coin_operations"("streamId");
