import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  ConversationListResponseSchema,
  ConversationResponseSchema,
  DirectMessageListResponseSchema,
  DirectMessageResponseSchema,
  authEndpoints,
  directEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const password = 'synthetic direct password';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; email: string };
const path = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key]!);

describe('Direct over REST with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(AuthRateLimiter)
      .useValue({ consume: () => undefined })
      .compile();
    app = fixture.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
  }, 30_000);
  afterAll(async () => {
    try {
      await database.prisma.user.deleteMany({
        where: { id: { in: ownedIds } },
      });
    } finally {
      await app.close();
    }
  });

  async function csrf(client: Agent): Promise<string> {
    const response = await client.get(authEndpoints.csrf.path).expect(200);
    return AuthCsrfResponseSchema.parse(response.body).csrfToken;
  }
  async function account(
    options: { verified?: boolean; isPrivate?: boolean } = {},
  ): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const email = `${suffix}@example.test`;
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email, username: `d_${suffix.slice(0, 20)}`, password })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    await database.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: options.verified === false ? null : new Date(),
        isPrivate: options.isPrivate ?? false,
      },
    });
    return { client, id: user.id, email };
  }
  async function post(who: Account, url: string, body: object) {
    const token = await csrf(who.client);
    return who.client
      .post(url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  async function open(who: Account, peer: Account) {
    const response = await post(who, directEndpoints.open.path, {
      userId: peer.id,
    });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return ConversationResponseSchema.parse(response.body).conversation;
  }
  const messagesUrl = (id: string) =>
    path(directEndpoints.messages.path, { id });
  async function send(
    who: Account,
    conversationId: string,
    text: string,
    clientMessageId: string = randomUUID(),
  ) {
    return post(who, messagesUrl(conversationId), { clientMessageId, text });
  }
  async function list(who: Account, query = '') {
    const response = await who.client
      .get(directEndpoints.conversations.path + query)
      .expect(200);
    return ConversationListResponseSchema.parse(response.body);
  }
  async function history(who: Account, id: string, query = '') {
    const response = await who.client.get(messagesUrl(id) + query).expect(200);
    return DirectMessageListResponseSchema.parse(response.body);
  }
  const errorCode = (body: unknown) =>
    AuthApiErrorResponseSchema.parse(body).error.code;

  it('requires a verified session and Origin/CSRF', async () => {
    const anonymous = request.agent(app.getHttpServer());
    expect(
      (await anonymous.get(directEndpoints.conversations.path)).status,
    ).toBe(401);
    const unverified = await account({ verified: false });
    const peer = await account();
    const denied = await post(unverified, directEndpoints.open.path, {
      userId: peer.id,
    });
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('EMAIL_VERIFICATION_REQUIRED');
    const sender = await account();
    const noCsrf = await sender.client
      .post(directEndpoints.open.path)
      .set('Origin', origin)
      .send({ userId: peer.id });
    expect(noCsrf.status).toBe(403);
  });

  it('opens one conversation per pair with anyone verified, including private accounts', async () => {
    const first = await account();
    const closed = await account({ isPrivate: true });
    const self = await post(first, directEndpoints.open.path, {
      userId: first.id,
    });
    expect(self.status).toBe(400);
    expect(errorCode(self.body)).toBe('CANNOT_MESSAGE_SELF');
    for (const userId of [
      randomUUID(),
      (await account({ verified: false })).id,
    ]) {
      const missing = await post(first, directEndpoints.open.path, { userId });
      expect(missing.status).toBe(404);
      expect(errorCode(missing.body)).toBe('USER_NOT_FOUND');
    }
    expect(
      (await post(first, directEndpoints.open.path, { userId: 'x' })).status,
    ).toBe(400);

    // No follow needed (FR-09); races from both sides meet in one row.
    const opened = await Promise.all([
      open(first, closed),
      open(closed, first),
      open(first, closed),
    ]);
    expect(new Set(opened.map((item) => item.id)).size).toBe(1);
    expect(opened[0]).toMatchObject({
      peer: { id: closed.id, isPrivate: true },
      lastMessage: null,
    });
    expect(opened[1]!.peer.id).toBe(first.id);
    expect(
      await database.prisma.conversation.count({
        where: { userAId: { in: [first.id, closed.id] } },
      }),
    ).toBe(1);
  });

  it('keeps conversations private to their two participants', async () => {
    const alice = await account();
    const bob = await account();
    const eve = await account();
    const { id } = await open(alice, bob);
    expect((await send(alice, id, 'секрет')).status).toBe(201);
    for (const [url, method] of [
      [path(directEndpoints.conversation.path, { id }), 'get'],
      [messagesUrl(id), 'get'],
    ] as const) {
      const response = await eve.client[method](url);
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('CONVERSATION_NOT_FOUND');
    }
    const write = await send(eve, id, 'вмешательство');
    expect(write.status).toBe(404);
    expect((await list(eve)).items).toEqual([]);
    expect(
      await database.prisma.directMessage.count({
        where: { conversationId: id },
      }),
    ).toBe(1);
  });

  it('validates messages and stores them with the conversation activity', async () => {
    const alice = await account();
    const bob = await account();
    const { id } = await open(alice, bob);
    for (const body of [
      { clientMessageId: randomUUID(), text: '' },
      { clientMessageId: randomUUID(), text: '  \n ' },
      { clientMessageId: randomUUID(), text: 'x'.repeat(1001) },
      { clientMessageId: randomUUID(), text: 'tab\t' },
      { clientMessageId: 'not-a-uuid', text: 'привет' },
      { clientMessageId: randomUUID(), text: 'привет', senderId: bob.id },
    ])
      expect((await post(alice, messagesUrl(id), body)).status).toBe(400);

    const sent = await send(alice, id, 'Привет!\nКак дела? 🙂');
    expect(sent.status).toBe(201);
    const message = DirectMessageResponseSchema.parse(sent.body).message;
    expect(message).toMatchObject({
      conversationId: id,
      senderId: alice.id,
      text: 'Привет!\nКак дела? 🙂',
    });
    const stored = await database.prisma.conversation.findUniqueOrThrow({
      where: { id },
      select: { lastActivityAt: true },
    });
    expect(stored.lastActivityAt.toISOString()).toBe(message.createdAt);
    expect((await send(bob, id, '🙂'.repeat(1000))).status).toBe(201);
  });

  it('never duplicates a retried message and rejects a reused id with other content', async () => {
    const alice = await account();
    const bob = await account();
    const carol = await account();
    const { id } = await open(alice, bob);
    const other = await open(alice, carol);
    const key = randomUUID();
    // Lost responses and double clicks: the same request several times.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => send(alice, id, 'один раз', key)),
    );
    for (const result of results) expect(result.status).toBe(201);
    const ids = results.map(
      (result) => DirectMessageResponseSchema.parse(result.body).message.id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(
      await database.prisma.directMessage.count({
        where: { conversationId: id },
      }),
    ).toBe(1);

    const changed = await send(alice, id, 'другой текст', key);
    expect(changed.status).toBe(409);
    expect(errorCode(changed.body)).toBe('MESSAGE_ID_CONFLICT');
    expect((await send(alice, other.id, 'один раз', key)).status).toBe(409);
    // Another sender may use the same id: keys are per sender.
    expect((await send(bob, id, 'ответ', key)).status).toBe(201);
  });

  it('lists conversations by last activity; empty ones only for their opener', async () => {
    const me = await account();
    const [first, second, third] = [
      await account(),
      await account(),
      await account(),
    ];
    const a = await open(me, first);
    const b = await open(me, second);
    const empty = await open(third, me);
    await send(me, a.id, 'первый');
    await send(second, b.id, 'второй');
    await send(first, a.id, 'снова первый');

    const mine = await list(me);
    expect(mine.items.map((item) => item.id)).toEqual([a.id, b.id]);
    expect(mine.items[0]!.lastMessage).toMatchObject({
      text: 'снова первый',
      senderId: first.id,
    });
    expect((await list(third)).items.map((item) => item.id)).toEqual([
      empty.id,
    ]);
    expect((await list(second)).items.map((item) => item.id)).toEqual([b.id]);

    const page = await list(me, '?limit=1');
    expect(page.items.map((item) => item.id)).toEqual([a.id]);
    const rest = await list(me, `?limit=1&cursor=${page.nextCursor}`);
    expect(rest).toMatchObject({ items: [{ id: b.id }], nextCursor: null });
  });

  it('pages history newest first without duplicates and keeps it after a new sign-in', async () => {
    const alice = await account();
    const bob = await account();
    const { id } = await open(alice, bob);
    const sent: string[] = [];
    for (let index = 0; index < 5; index++) {
      const response = await send(index % 2 ? bob : alice, id, `m${index}`);
      sent.push(DirectMessageResponseSchema.parse(response.body).message.id);
    }
    // Equal timestamps: the id breaks ties.
    await database.prisma.directMessage.updateMany({
      where: { id: { in: sent.slice(1, 4) } },
      data: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    const seen: string[] = [];
    let cursor: string | null = '';
    while (cursor !== null) {
      const page = await history(
        bob,
        id,
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(sent));
    expect(seen[0]).toBe(sent[4]);

    // A fresh session (re-login) reads the same stored history.
    const again = request.agent(app.getHttpServer());
    const token = await csrf(again);
    await again
      .post(authEndpoints.login.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email: alice.email, password })
      .expect(200);
    const reread = DirectMessageListResponseSchema.parse(
      (await again.get(messagesUrl(id) + '?limit=50').expect(200)).body,
    );
    expect(reread.items.map((item) => item.id)).toEqual(seen);
  });
});
