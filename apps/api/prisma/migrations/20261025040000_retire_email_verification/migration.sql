-- Stop outstanding legacy verification mail without altering ownership metadata.
UPDATE mail_deliveries SET "cancelledAt"=CURRENT_TIMESTAMP,payload=NULL,"claimId"=NULL,"leaseUntil"=NULL
WHERE "sentAt" IS NULL AND "cancelledAt" IS NULL AND "tokenId" IN (SELECT id FROM auth_tokens WHERE purpose='EMAIL_VERIFICATION');
UPDATE auth_tokens SET "revokedAt"=CURRENT_TIMESTAMP
WHERE purpose='EMAIL_VERIFICATION' AND "consumedAt" IS NULL AND "revokedAt" IS NULL;
