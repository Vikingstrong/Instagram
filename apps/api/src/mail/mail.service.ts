import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { Prisma, AuthTokenPurpose } from '../generated/prisma/client.js';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { MAIL_CONFIG, type MailConfiguration } from './mail.config.js';
import { SmtpSender } from './smtp.sender.js';

@Injectable()
export class MailService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MAIL_CONFIG) private readonly config: MailConfiguration,
    @Inject(SmtpSender) private readonly sender: SmtpSender,
  ) {}

  assertAvailable(): void {
    if (!this.config.enabled || !this.config.key)
      throw new ServiceUnavailableException();
  }
  recoveryAvailable(): boolean {
    return this.config.enabled && !!this.config.key;
  }

  private encrypt(value: string, tokenId: string): string {
    if (!this.config.key) throw new ServiceUnavailableException();
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.key, 'hex'),
      iv,
    );
    cipher.setAAD(Buffer.from(tokenId));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }
  private decrypt(value: string, tokenId: string): string {
    if (!this.config.key) throw new ServiceUnavailableException();
    const parts = value.split('.');
    const [version, iv, tag, payload] = parts;
    if (parts.length !== 4 || version !== 'v1' || !iv || !tag || !payload)
      throw new Error('Invalid encrypted mail payload.');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.key, 'hex'),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(tokenId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  // Auth owns the surrounding transaction; all mail-owned writes stay here.
  async enqueue(
    tx: Prisma.TransactionClient,
    tokenId: string,
    link: string,
  ): Promise<void> {
    await tx.mailDelivery.create({
      data: { tokenId, payload: this.encrypt(link, tokenId) },
    });
  }
  async cancel(
    tx: Prisma.TransactionClient,
    userId: string,
    purpose?: AuthTokenPurpose,
  ): Promise<void> {
    await tx.mailDelivery.updateMany({
      where: {
        sentAt: null,
        cancelledAt: null,
        token: { userId, ...(purpose ? { purpose } : {}) },
      },
      data: {
        cancelledAt: new Date(),
        payload: null,
        claimId: null,
        leaseUntil: null,
      },
    });
  }

  onApplicationBootstrap(): void {
    if (!this.config.worker || !this.config.key) return;
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.processOne()
        .catch(() => {
          // Database/SMTP exceptions can contain secrets; retry via lease expiry.
        })
        .finally(() => {
          this.inFlight = undefined;
        });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  // Public to the API's integration harness, never an HTTP endpoint.
  async processOne(userId: string | null = null): Promise<void> {
    if (!this.recoveryAvailable()) return;
    const claim = randomUUID();
    const claimed = await this.database.prisma.$queryRaw<{ id: string }[]>`
      UPDATE mail_deliveries SET "claimId" = ${claim}::uuid,
        "leaseUntil" = CURRENT_TIMESTAMP + interval '90 seconds', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM mail_deliveries
        WHERE "sentAt" IS NULL AND "cancelledAt" IS NULL
          AND (${userId}::uuid IS NULL OR "tokenId" IN (SELECT id FROM auth_tokens WHERE "userId" = ${userId}::uuid))
          AND "nextAttemptAt" <= CURRENT_TIMESTAMP
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= CURRENT_TIMESTAMP)
        ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING id`;
    if (!claimed[0]) return;
    const delivery = await this.database.prisma.mailDelivery.findUnique({
      where: { id: claimed[0].id },
      include: { token: { include: { user: true } } },
    });
    if (
      !delivery ||
      delivery.claimId !== claim ||
      delivery.cancelledAt ||
      delivery.sentAt
    )
      return;
    const { token } = delivery;
    const where = {
      id: delivery.id,
      claimId: claim,
      cancelledAt: null,
      sentAt: null,
    };
    if (
      !delivery.payload ||
      token.consumedAt ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      token.credentialVersion !== token.user.credentialVersion ||
      token.purpose !== 'PASSWORD_RESET'
    ) {
      await this.database.prisma.mailDelivery.updateMany({
        where,
        data: {
          cancelledAt: new Date(),
          payload: null,
          claimId: null,
          leaseUntil: null,
        },
      });
      return;
    }
    try {
      await this.sender.send({
        id: delivery.id,
        to: token.user.email,
        link: this.decrypt(delivery.payload, delivery.tokenId),
      });
      await this.database.prisma.mailDelivery.updateMany({
        where,
        data: {
          sentAt: new Date(),
          payload: null,
          claimId: null,
          leaseUntil: null,
        },
      });
    } catch {
      await this.database.prisma.mailDelivery.updateMany({
        where,
        data: {
          claimId: null,
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(
                3600_000,
                30_000 * 2 ** Math.min(delivery.attempts - 1, 7),
              ),
          ),
        },
      });
    }
  }
}
