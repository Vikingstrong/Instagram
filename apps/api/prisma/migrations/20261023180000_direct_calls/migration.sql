BEGIN;
-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACTIVE', 'ENDED', 'DECLINED', 'MISSED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('AUDIO', 'VIDEO');

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "callerId" UUID NOT NULL,
    "calleeId" UUID NOT NULL,
    "callerSessionHash" VARCHAR(64) NOT NULL,
    "calleeSessionHash" VARCHAR(64),
    "callerClientId" UUID NOT NULL,
    "calleeClientId" UUID,
    "kind" "CallKind" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "callerSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calleeSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_seats" (
    "userId" UUID NOT NULL,
    "callId" UUID NOT NULL,

    CONSTRAINT "call_seats_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "calls_conversationId_createdAt_id_idx" ON "calls"("conversationId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "calls_status_createdAt_idx" ON "calls"("status", "createdAt");

-- CreateIndex
CREATE INDEX "call_seats_callId_idx" ON "call_seats"("callId");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_seats" ADD CONSTRAINT "call_seats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_seats" ADD CONSTRAINT "call_seats_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "calls" ADD CONSTRAINT "calls_distinct_participants" CHECK ("callerId" <> "calleeId");
ALTER TABLE "calls" ADD CONSTRAINT "calls_terminal_timestamp" CHECK (("status" IN ('RINGING', 'ACTIVE')) = ("endedAt" IS NULL));
ALTER TABLE "calls" ADD CONSTRAINT "calls_active_answer" CHECK ("status" <> 'ACTIVE' OR ("answeredAt" IS NOT NULL AND "calleeClientId" IS NOT NULL AND "calleeSessionHash" IS NOT NULL AND "calleeSeenAt" IS NOT NULL));

COMMIT;
