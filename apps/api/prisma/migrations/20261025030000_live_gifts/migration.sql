BEGIN;

-- Gifts in live streams (FR-14): one row per coin transfer to the host,
-- keyed by that coin operation; the stream shows them to its viewers.
-- CreateTable
CREATE TABLE "live_gifts" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "giftKey" VARCHAR(80) NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_gifts_liveId_createdAt_id_idx" ON "live_gifts"("liveId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "live_gifts_senderId_idempotencyKey_key" ON "live_gifts"("senderId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "live_gifts" ADD CONSTRAINT "live_gifts_id_fkey" FOREIGN KEY ("id") REFERENCES "coin_operations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_gifts" ADD CONSTRAINT "live_gifts_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "lives"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "live_gifts" ADD CONSTRAINT "live_gifts_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "auth_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- CheckConstraint
ALTER TABLE "live_gifts" ADD CONSTRAINT "live_gifts_price_check" CHECK ("price" > 0 AND length("giftKey") > 0);

COMMIT;
