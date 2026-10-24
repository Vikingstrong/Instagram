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
import { SessionGuard } from '../src/auth/auth-session.guard.js';
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
// Reset accepts the same eight-code-point minimum as registration.
const nextPassword = 're set🔐8';
const key = 'd'.repeat(64);
type Agent = ReturnType<typeof request.agent>;
@Controller('__test/email-protected')
class ProtectedFixture {
  @Get()
  @UseGuards(SessionGuard)
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
  async function createApp(
    sender?: Pick<SmtpSender, 'send'>,
    encryptionKey: string | null = key,
  ) {
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
          PASSWORD_RECOVERY_ENABLED: 'true',
          SMTP_HOST: 'smtp.example.test',
          SMTP_FROM: 'sender@example.test',
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
    const message = sent.findLast((m) => m.to === account.email);
    if (!message) throw new Error('Missing recovery delivery');
    return rawToken(message);
  }

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
    ).toBe(1);
    // A fresh limiter cannot bypass the database's recipient cooldown.
    await app.get(AuthService).requestEmail(account.email, 'PASSWORD_RESET');
    expect(
      await db.prisma.authToken.count({ where: { userId: account.id } }),
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
    expect(result.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 400,
    ]);
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
    const paths = ['password/request', 'password/reset'];
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

  it('retries encrypted mail after worker recreation, with one leased send and payload cleanup', async () => {
    const account = await register();
    await post(agent(), 'password/request', { email: account.email });
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
          await post(agent(), 'password/reset', {
            token: rawToken(sent[0]!),
            password: nextPassword,
          })
        ).status,
      ).toBe(200);
    } finally {
      await restarted.close();
    }
  });

  it('recovers an abandoned lease and never sends expired or revoked tokens', async () => {
    const account = await register();
    await post(agent(), 'password/request', { email: account.email });
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
      where: {
        sentAt: null,
        token: { userId: account.id, purpose: 'PASSWORD_RESET' },
      },
    });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.payload).toBeNull();
  });

  it('rejects swapping encrypted payloads between recipients and recovers after restoring them', async () => {
    const first = await register();
    const second = await register();
    await post(agent(), 'password/request', { email: first.email });
    await post(agent(), 'password/request', { email: second.email });
    const jobs = await db.prisma.mailDelivery.findMany({
      where: { token: { userId: { in: [first.id, second.id] } } },
      orderBy: { id: 'asc' },
    });
    expect(jobs).toHaveLength(2);
    await db.prisma.mailDelivery.update({
      where: { id: jobs[0]!.id },
      data: { payload: jobs[1]!.payload },
    });
    await db.prisma.mailDelivery.update({
      where: { id: jobs[1]!.id },
      data: { payload: jobs[0]!.payload },
    });
    await mail.processOne();
    await mail.processOne();
    expect(sent).toHaveLength(0);
    for (const job of jobs)
      await db.prisma.mailDelivery.update({
        where: { id: job.id },
        data: {
          payload: job.payload,
          nextAttemptAt: new Date(Date.now() - 1000),
        },
      });
    await mail.processOne();
    await mail.processOne();
    expect(sent.map((message) => message.to).sort()).toEqual(
      [first.email, second.email].sort(),
    );
  });

  it('registers and authorizes with no verification, even when mail enqueue would fail', async () => {
    const enqueue = vi
      .spyOn(mail, 'enqueue')
      .mockRejectedValue(new Error('Synthetic unavailable mail'));
    const client = agent();
    const suffix = randomUUID().replaceAll('-', '');
    const response = await post(client, 'register', {
      email: `${suffix}@example.test`,
      username: `u_${suffix.slice(0, 20)}`,
      password,
    });
    expect(response.status).toBe(201);
    ids.push(response.body.user.id);
    expect(response.body.user.emailVerified).toBe(false);
    await client.get('/api/v1/__test/email-protected').expect(200);
    expect(enqueue).not.toHaveBeenCalled();
    expect(
      await db.prisma.authToken.count({
        where: { userId: response.body.user.id },
      }),
    ).toBe(0);
    expect(
      await db.prisma.mailDelivery.count({
        where: { token: { userId: response.body.user.id } },
      }),
    ).toBe(0);
  });
  it('retired verification endpoints cannot confirm historical ownership metadata', async () => {
    const account = await register();
    expect(
      (await post(agent(), 'verification/request', { email: account.email }))
        .status,
    ).toBe(404);
    expect(
      (await post(agent(), 'verification/confirm', { token: 'a'.repeat(43) }))
        .status,
    ).toBe(404);
    expect(
      (await db.prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
        .emailVerifiedAt,
    ).toBeNull();
  });
  it('rejects expired, wrong-purpose and replayed recovery tokens safely', async () => {
    const account = await register();
    const token = await recovery(account);
    await db.prisma.authToken.updateMany({
      where: { userId: account.id },
      data: {
        expiresAt: new Date(Date.now() - 1),
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    expect(
      (await post(agent(), 'password/reset', { token, password: nextPassword }))
        .status,
    ).toBe(400);
    const raw = 'z'.repeat(43);
    await db.prisma.authToken.create({
      data: {
        userId: account.id,
        purpose: 'EMAIL_VERIFICATION',
        credentialVersion: 0,
        tokenHash: sessionHash(raw),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    expect(
      (
        await post(agent(), 'password/reset', {
          token: raw,
          password: nextPassword,
        })
      ).status,
    ).toBe(400);
  });
  it('allows registration without a recovery key while rejecting unavailable recovery for all addresses', async () => {
    await app.close();
    app = await createApp({ send: () => Promise.resolve() }, null);
    db = app.get(DatabaseService);
    mail = app.get(MailService);
    const account = await register();
    for (const email of [account.email, 'not-an-account@example.test'])
      expect((await post(agent(), 'password/request', { email })).status).toBe(
        503,
      );
    expect(
      await db.prisma.authToken.count({ where: { userId: account.id } }),
    ).toBe(0);
  });
});
