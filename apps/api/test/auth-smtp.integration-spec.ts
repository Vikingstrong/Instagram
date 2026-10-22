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

// Explicit real SMTP check. Missing Mailpit fails rather than silently skips.
describe('SMTP adapter → real Mailpit', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const ownedIds: string[] = [];
  beforeAll(async () => {
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
        ...readMailConfiguration({ ...process.env, NODE_ENV: 'test' }),
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
    }
  });

  it('delivers a queued registration link and consumes the delivered token through HTTP', async () => {
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
    await app.get(MailService).processOne();
    const ui = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
    const mailboxResponse = await fetch(`${ui}/api/v1/messages`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(mailboxResponse.status).toBe(200);
    const mailbox = (await mailboxResponse.json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    const message = mailbox.messages.find((m) =>
      m.To.some((recipient) => recipient.Address === email),
    );
    expect(Boolean(message)).toBe(true);
    if (!message)
      throw new Error('The synthetic SMTP message was not delivered.');
    const response = await fetch(`${ui}/api/v1/message/${message.ID}`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { Text: string };
    const line = body.Text.split('\n').find((value) =>
      value.trim().startsWith('http://localhost:3000/auth/verify#token='),
    );
    expect(Boolean(line)).toBe(true);
    if (!line)
      throw new Error('The delivered message has no verification link.');
    const link = new URL(line.trim());
    const token = new URLSearchParams(link.hash.slice(1)).get('token')!;
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
    expect((await post('verification/confirm', { token })).status).toBe(200);
  });
});
