BEGIN;

-- Direct (FR-09): one conversation per ordered pair of users; messages are
-- unique per sender and clientMessageId and never blank.
-- CreateTable
CREATE TABLE "direct_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direct_conversations_userAId_lastActivityAt_id_idx" ON "direct_conversations"("userAId", "lastActivityAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "direct_conversations_userBId_lastActivityAt_id_idx" ON "direct_conversations"("userBId", "lastActivityAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "direct_conversations_userAId_userBId_key" ON "direct_conversations"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "direct_messages_conversationId_createdAt_id_idx" ON "direct_messages"("conversationId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "direct_messages_senderId_clientMessageId_key" ON "direct_messages"("senderId", "clientMessageId");

-- AddForeignKey
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "direct_conversations"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- CheckConstraint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_ordered_pair" CHECK ("userAId" < "userBId");
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_creator_is_participant" CHECK ("createdById" IN ("userAId", "userBId"));
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_text_not_blank" CHECK ("text" ~ '\S');

COMMIT;
