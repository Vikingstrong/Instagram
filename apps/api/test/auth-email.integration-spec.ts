import {
  Controller,
  Get,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { AuthService, sessionHash } from '../src/auth/auth.service.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { VerifiedSessionGuard } from '../src/auth/auth-session.guard.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { MailService } from '../src/mail/mail.service.js';
import { MAIL_CONFIG, readMailConfiguration } from '../src/mail/mail.config.js';
import { SmtpSender, type AuthMail } from '../src/mail/smtp.sender.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const password = 'synthetic initial password 🔐';
const nextPassword = 'synthetic replacement password 🔐';
const key = 'd'.repeat(64);
type Agent = ReturnType<typeof request.agent>;
@Controller('__test/email-protected')
class ProtectedFixture {
  @Get()
  @UseGuards(VerifiedSessionGuard)
  get() {
    return { ok: true };
  }
}

describe('Auth email and durable delivery with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  let mail: MailService;
  let sent: AuthMail[];
  const ids: string[] = [];
  async function createApp(sender?: Pick<SmtpSender, 'send'>, encryptionKey: string | null = key) {
    const builder = Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [ProtectedFixture],
    })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(MAIL_CONFIG)
      .useValue({
        ...readMailConfiguration({
          ...process.env,
          NODE_ENV: 'test',
          MAIL_OUTBOX_KEY: key,
        }),
        worker: false,
        key: encryptionKey ?? undefined,
      });
    if (sender) builder.overrideProvider(SmtpSender).useValue(sender);
    const module = await builder.compile();
    const instance = module.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(instance);
    await instance.init();
    return instance;
  }
  beforeEach(async () => {
    sent = [];
    app = await createApp({
      send: (value: AuthMail) => {
        sent.push(value);
        return Promise.resolve();
      },
    });
    db = app.get(DatabaseService);
    mail = app.get(MailService);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await db.prisma.user.deleteMany({ where: { id: { in: ids.splice(0) } } });
    } finally {
      await app.close();
    }
  });
  function agent() {
    return request.agent(app.getHttpServer());
  }
  async function post(client: Agent, path: string, body: object) {
    const csrf = await client.get('/api/v1/auth/csrf').expect(200);
    return client
      .post(`/api/v1/auth/${path}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf.body.csrfToken as string)
      .send(body);
  }
  async function register() {
    const suffix = randomUUID().replaceAll('-', '');
    const input = {
      email: `${suffix}@example.test`,
      username: `u_${suffix.slice(0, 20)}`,
      password,
    };
    const response = await post(agent(), 'register', input);
    expect(response.status).toBe(201);
    const id = (response.body as { user: { id: string } }).user.id;
    ids.push(id);
    return { ...input, id };
  }
  function rawToken(message: AuthMail) {
    return new URLSearchParams(new URL(message.link).hash.slice(1)).get(
      'token',
    )!;
  }
  async function cooldown(id: string) {
    // Simulate elapsed cooldown on this fixture, never sleep/reset shared data.
    await db.prisma.authToken.updateMany({
      where: { userId: id },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
  }
  async function recovery(account: Awaited<ReturnType<typeof register>>) {
    await cooldown(account.id);
    expect(
      (await post(agent(), 'password/request', { email: account.email }))
        .status,
    ).toBe(202);
    await mail.processOne();
    const message = sent.findLast(
      (m) => m.to === account.email && !m.verification,
    );
    if (!message) throw new Error('Missing recovery delivery');
    return rawToken(message);
  }

  it('atomically queues encrypted verification mail, verifies once and unlocks existing sessions', async () => {
    const account = await register();
    const browser = agent();
    expect(
      (await post(browser, 'login', { email: account.email, password })).status,
    ).toBe(200);
    await browser.get('/api/v1/__test/email-protected').expect(403);
    const queued = await db.prisma.mailDelivery.findFirstOrThrow({
      where: { token: { userId: account.id } },
    });
    expect(queued.payload?.startsWith('v1.')).toBe(true);
    await mail.processOne();
    expect(sent).toHaveLength(1);
    const token = rawToken(sent[0]!);
    expect(queued.payload).not.toContain(token);
    expect(new URL(sent[0]!.link).search).toBe('');
    const stored = await db.prisma.authToken.findUniqueOrThrow({
      where: { tokenHash: sessionHash(token) },
    });
    expect(
      stored.expiresAt.getTime() - stored.createdAt.getTime(),
    ).toBeGreaterThan(23 * 3600_000);
    const results = await Promise.all([
      post(agent(), 'verification/confirm', { token }),
      post(agent(), 'verification/confirm', { token }),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 400]);
    const invalid = results.find((r) => r.status === 400)!;
    expect(invalid.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(invalid.headers['cache-control']).toBe('no-store');
    await browser.get('/api/v1/__test/email-protected').expect(200);
    const delivery = await db.prisma.mailDelivery.findUniqueOrThrow({
      where: { id: queued.id },
    });
    expect(delivery.payload).toBeNull();
    expect(delivery.sentAt).not.toBeNull();
  });

  it('rejects wrong purpose, expiry, tampering and replay with one safe error', async () => {
    const account = await register();
    await mail.processOne();
    const token = rawToken(sent[0]!);
    expect(
      (await post(agent(), 'password/reset', { token, password: nextPassword }))
        .body.error.code,
    ).toBe('INVALID_OR_EXPIRED_TOKEN');
    const stored = await db.prisma.authToken.findUniqueOrThrow({
      where: { tokenHash: sessionHash(token) },
    });
    await db.prisma.authToken.update({
      where: { id: stored.id },
      data: {
        createdAt: new Date(Date.now() - 3600_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    for (const candidate of [token, 'a'.repeat(43)]) {
      const response = await post(agent(), 'verification/confirm', {
        token: candidate,
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
      expect(response.text).not.toContain(candidate);
    }
    expect(
      (await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
        .emailVerifiedAt,
    ).toBeNull();
  });

  it('returns identical generic acceptance and quotas for existing and unknown addresses', async () => {
    const account = await register();
    await mail.processOne();
    await cooldown(account.id);
    const unknown = `${randomUUID()}@example.test`;
    for (const email of [account.email, unknown]) {
      const response = await post(agent(), 'password/request', { email });
      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: 'accepted' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await post(agent(), 'password/request', { email })).status).toBe(
        429,
      );
    }
    expect(
      await db.prisma.authToken.count({ where: { userId: account.id } }),
    ).toBe(2);
    // A fresh limiter cannot bypass the database's recipient cooldown.
    await app.get(AuthService).requestEmail(account.email, 'PASSWORD_RESET');
    expect(
      await db.prisma.authToken.count({ where: { userId: account.id } }),
    ).toBe(2);
  });

  it('replaces old verification links, caps durable recipient issuance and cancels stale jobs', async () => {
    const account = await register();
    await mail.processOne();
    const first = rawToken(sent[0]!);
    for (let i = 0; i < 3; i++) {
      await cooldown(account.id);
      await app
        .get(AuthService)
        .requestEmail(account.email, 'EMAIL_VERIFICATION');
    }
    expect(
      await db.prisma.authToken.count({ where: { userId: account.id } }),
    ).toBe(3);
    expect(
      (await post(agent(), 'verification/confirm', { token: first })).status,
    ).toBe(400);
    expect(
      await db.prisma.mailDelivery.count({
        where: { token: { userId: account.id }, cancelledAt: { not: null } },
      }),
    ).toBe(1);
  });

  it('allows only one concurrent reset and revokes all sessions and outstanding tokens atomically', async () => {
    const account = await register();
    await mail.processOne();
    const clients = [agent(), agent()];
    for (const client of clients)
      expect(
        (await post(client, 'login', { email: account.email, password }))
          .status,
      ).toBe(200);
    const token = await recovery(account);
    const result = await Promise.all(
      clients.map((client) =>
        post(client, 'password/reset', { token, password: nextPassword }),
      ),
    );
    expect(result.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 400]);
    for (const client of clients) {
      const response = await client.get('/api/v1/auth/session').expect(200);
      expect(response.body).toEqual({ user: null });
    }
    expect(
      await db.prisma.authSession.count({
        where: { userId: account.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await db.prisma.authToken.count({
        where: { userId: account.id, revokedAt: null, consumedAt: null },
      }),
    ).toBe(0);
    expect(
      (await post(agent(), 'login', { email: account.email, password })).status,
    ).toBe(401);
    expect(
      (
        await post(agent(), 'login', {
          email: account.email,
          password: nextPassword,
        })
      ).status,
    ).toBe(200);
  });

  it('rejects a login whose old hash check raced with a completed reset', async () => {
    const account = await register();
    await mail.processOne();
    const token = await recovery(account);
    const hasher = app.get(PasswordHasher);
    const verify = hasher.verify.bind(hasher);
    vi.spyOn(hasher, 'verify').mockImplementationOnce(async (...args) => {
      const result = await verify(...args);
      await app.get(AuthService).resetPassword(token, nextPassword);
      return result;
    });
    expect(
      (await post(agent(), 'login', { email: account.email, password })).status,
    ).toBe(401);
    expect(
      await db.prisma.authSession.count({
        where: { userId: account.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('preserves another account session when it submits a valid reset link', async () => {
    const first = await register();
    await mail.processOne();
    const second = await register();
    await mail.processOne();
    const browser = agent();
    expect(
      (await post(browser, 'login', { email: second.email, password })).status,
    ).toBe(200);
    const token = await recovery(first);
    expect(
      (await post(browser, 'password/reset', { token, password: nextPassword }))
        .status,
    ).toBe(200);
    expect(
      (await browser.get('/api/v1/auth/session').expect(200)).body.user.id,
    ).toBe(second.id);
  });

  it('requires Origin/CSRF and shared input validation on every new mutation', async () => {
    const paths = [
      'verification/request',
      'verification/confirm',
      'password/request',
      'password/reset',
    ];
    for (const path of paths) {
      const response = await agent().post(`/api/v1/auth/${path}`).send({});
      expect(response.status).toBe(403);
      expect(
        (
          await post(agent(), path, {
            token: 'a'.repeat(43),
            password: 'short',
            email: 'bad',
            emailVerified: true,
          })
        ).status,
      ).toBe(400);
    }
  });

  it('rolls registration back if durable mail enqueue fails', async () => {
    vi.spyOn(mail, 'enqueue').mockRejectedValueOnce(
      new Error('synthetic enqueue failure'),
    );
    const suffix = randomUUID().replaceAll('-', '');
    const response = await post(agent(), 'register', {
      email: `${suffix}@example.test`,
      username: `u_${suffix.slice(0, 20)}`,
      password,
    });
    expect(response.status).toBe(500);
    expect(response.text).not.toContain('synthetic');
    expect(
      await db.prisma.user.count({
        where: { emailKey: `${suffix}@example.test` },
      }),
    ).toBe(0);
  });

  it('retries encrypted mail after worker recreation, with one leased send and payload cleanup', async () => {
    const account = await register();
    const send = vi
      .spyOn(app.get(SmtpSender), 'send')
      .mockRejectedValueOnce(new Error('SMTP secret must not leak'));
    await mail.processOne();
    const failed = await db.prisma.mailDelivery.findFirstOrThrow({
      where: { token: { userId: account.id } },
    });
    expect(failed.attempts).toBe(1);
    expect(failed.sentAt).toBeNull();
    expect(failed.payload?.startsWith('v1.')).toBe(true);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    send.mockRestore();
    const restarted = await createApp({
      send: (value: AuthMail) => {
        sent.push(value);
        return Promise.resolve();
      },
    });
    try {
      await db.prisma.mailDelivery.update({
        where: { id: failed.id },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await Promise.all([
        restarted.get(MailService).processOne(),
        mail.processOne(),
      ]);
      expect(sent).toHaveLength(1);
      const success = await db.prisma.mailDelivery.findUniqueOrThrow({
        where: { id: failed.id },
      });
      expect(success.sentAt).not.toBeNull();
      expect(success.payload).toBeNull();
      expect(success.attempts).toBe(2);
      expect(
        (
          await post(agent(), 'verification/confirm', {
            token: rawToken(sent[0]!),
          })
        ).status,
      ).toBe(200);
    } finally {
      await restarted.close();
    }
  });

  it('recovers an abandoned lease and never sends expired or revoked tokens', async () => {
    const account = await register();
    const queued = await db.prisma.mailDelivery.findFirstOrThrow({
      where: { token: { userId: account.id } },
    });
    await db.prisma.mailDelivery.update({
      where: { id: queued.id },
      data: { claimId: randomUUID(), leaseUntil: new Date(Date.now() - 1000) },
    });
    await mail.processOne();
    expect(sent).toHaveLength(1);
    await cooldown(account.id);
    await app.get(AuthService).requestEmail(account.email, 'PASSWORD_RESET');
    await db.prisma.authToken.updateMany({
      where: { userId: account.id, purpose: 'PASSWORD_RESET' },
      data: { revokedAt: new Date() },
    });
    await mail.processOne();
    expect(sent).toHaveLength(1);
    const cancelled = await db.prisma.mailDelivery.findFirstOrThrow({
      where: { token: { userId: account.id, purpose: 'PASSWORD_RESET' } },
    });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.payload).toBeNull();
  });

  it('rejects swapping encrypted payloads between recipients and recovers after restoring them', async () => {
    const first = await register();
    const second = await register();
    const jobs = await db.prisma.mailDelivery.findMany({ where: { token: { userId: { in: [first.id, second.id] } } }, orderBy: { id: 'asc' } });
    expect(jobs).toHaveLength(2);
    await db.prisma.mailDelivery.update({ where: { id: jobs[0]!.id }, data: { payload: jobs[1]!.payload } });
    await db.prisma.mailDelivery.update({ where: { id: jobs[1]!.id }, data: { payload: jobs[0]!.payload } });
    await mail.processOne(); await mail.processOne();
    expect(sent).toHaveLength(0);
    for (const job of jobs) await db.prisma.mailDelivery.update({ where: { id: job.id }, data: { payload: job.payload, nextAttemptAt: new Date(Date.now() - 1000) } });
    await mail.processOne(); await mail.processOne();
    expect(sent.map(message => message.to).sort()).toEqual([first.email, second.email].sort());
  });

  it('fails safely and rolls registration back when the persistent outbox key is missing', async () => {
    const unavailable = await createApp(undefined, null);
    try {
      const suffix = randomUUID().replaceAll('-', '');
      const email = `${suffix}@example.test`;
      const response = await post(request.agent(unavailable.getHttpServer()), 'register', { email, username: `u_${suffix.slice(0, 20)}`, password });
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.text.includes('MAIL_OUTBOX_KEY')).toBe(false);
      expect(await db.prisma.user.count({ where: { emailKey: email } })).toBe(0);
    } finally { await unavailable.close(); }
  });
});
