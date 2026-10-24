import { startTestSmtp } from './helpers/test-smtp.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { MAIL_CONFIG, readMailConfiguration } from '../src/mail/mail.config.js';
import { MailService } from '../src/mail/mail.service.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { sessionHash } from '../src/auth/auth.service.js';
import { configureApp } from '../src/configure-app.js';

// Real SMTP protocol, using an in-process loopback receiver.
describe('Recovery SMTP adapter → local test receiver', () => {
  let app: INestApplication<App>;
  let smtp: Awaited<ReturnType<typeof startTestSmtp>>;
  let db: DatabaseService;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    smtp = await startTestSmtp();
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({
        factory: () =>
          new DatabaseService(readDatabaseUrl(process.env, 'test')),
      })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(MAIL_CONFIG)
      .useValue({
        ...readMailConfiguration({
          NODE_ENV: 'test',
          MAIL_OUTBOX_KEY: 'd'.repeat(64),
          PASSWORD_RECOVERY_ENABLED: 'true',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: String(smtp.port),
          SMTP_FROM: 'sender@example.test',
        }),
        worker: false,
      })
      .compile();
    app = fixture.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
  });
  afterAll(async () => {
    try {
      await db.prisma.user.deleteMany({ where: { id: { in: ownedIds } } });
    } finally {
      await app.close();
      await smtp.close();
    }
  });

  it('registers without mail, then delivers optional recovery through SMTP and consumes it once', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const email = `smtp-${suffix}@example.test`;
    const agent = request.agent(app.getHttpServer());
    async function post(path: string, body: object) {
      const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      return agent
        .post(`/api/v1/auth/${path}`)
        .set('Origin', 'http://localhost:3000')
        .set('X-CSRF-Token', csrf.body.csrfToken as string)
        .send(body);
    }
    const registration = await post('register', {
      email,
      username: `u_${suffix.slice(0, 20)}`,
      password: 'synthetic SMTP password 🔐',
    });
    expect(registration.status).toBe(201);
    ownedIds.push((registration.body as { user: { id: string } }).user.id);
    expect(smtp.messages).toHaveLength(0);
    expect((await post('password/request', { email })).status).toBe(202);
    await app.get(MailService).processOne();
    expect(smtp.messages).toHaveLength(1);
    const message = smtp.messages[0]!;
    expect(message.to).toContain(email);
    const token = /reset-password#token=([A-Za-z0-9_-]{43})/.exec(
      message.text,
    )?.[1];
    if (!token)
      throw new Error('Missing synthetic recovery token in SMTP message');
    expect(registration.text.includes(token)).toBe(false);
    const stored = await db.prisma.authToken.findUniqueOrThrow({
      where: { tokenHash: sessionHash(token) },
    });
    expect(stored.userId).toBe(ownedIds[0]);
    const delivery = await db.prisma.mailDelivery.findUniqueOrThrow({
      where: { tokenId: stored.id },
    });
    expect(delivery.sentAt !== null).toBe(true);
    expect(delivery.payload).toBeNull();
    expect(
      (
        await post('password/reset', {
          token,
          password: 'replacement SMTP password',
        })
      ).status,
    ).toBe(200);
  });
});
