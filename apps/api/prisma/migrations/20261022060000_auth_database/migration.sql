BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "auth_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "emailKey" VARCHAR(254) NOT NULL,
    "username" VARCHAR(30) NOT NULL,
    "usernameKey" VARCHAR(30) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "credentialVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_emailKey_key" ON "auth_users"("emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_usernameKey_key" ON "auth_users"("usernameKey");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_revokedAt_idx" ON "auth_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_tokens_userId_purpose_idx" ON "auth_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "auth_tokens_expiresAt_idx" ON "auth_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- These CHECK constraints are intentionally versioned SQL: Prisma schema
-- does not express them. Future migrations must preserve them.
ALTER TABLE "auth_users"
    ADD CONSTRAINT "auth_users_email_key_check"
        CHECK (length("email") > 0 AND "emailKey" = lower("email" COLLATE "C")),
    ADD CONSTRAINT "auth_users_username_key_check"
        CHECK (length("username") BETWEEN 3 AND 30
            AND "username" !~ '[^A-Za-z0-9_.]'
            AND "usernameKey" = lower("username" COLLATE "C")),
    ADD CONSTRAINT "auth_users_password_hash_check"
        CHECK (octet_length("passwordHash") BETWEEN 1 AND 1024),
    ADD CONSTRAINT "auth_users_credential_version_check"
        CHECK ("credentialVersion" >= 0);

ALTER TABLE "auth_sessions"
    ADD CONSTRAINT "auth_sessions_hash_check"
        CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "auth_sessions_credential_version_check"
        CHECK ("credentialVersion" >= 0),
    ADD CONSTRAINT "auth_sessions_dates_check"
        CHECK ("expiresAt" > "createdAt"
            AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt"));

ALTER TABLE "auth_tokens"
    ADD CONSTRAINT "auth_tokens_hash_check"
        CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "auth_tokens_credential_version_check"
        CHECK ("credentialVersion" >= 0),
    ADD CONSTRAINT "auth_tokens_dates_check"
        CHECK ("expiresAt" > "createdAt"
            AND ("consumedAt" IS NULL OR
                ("consumedAt" >= "createdAt" AND "consumedAt" < "expiresAt"))
            AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
            AND ("consumedAt" IS NULL OR "revokedAt" IS NULL));

COMMIT;
