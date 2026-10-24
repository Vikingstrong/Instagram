import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { MediaService } from '../src/media/media.service.js';
import { DirectEvents } from '../src/direct/direct-events.js';
import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  ConversationListResponseSchema,
  ConversationResponseSchema,
  DirectMessageListResponseSchema,
  DirectMessageResponseSchema,
  ShareContentResponseSchema,
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
  let root: string;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'instagram-direct-media-'));
    process.env.MEDIA_ROOT = root;
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
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
  }, 30_000);
  afterAll(async () => {
    try {
      await database.prisma.user.deleteMany({
        where: { id: { in: ownedIds } },
      });
    } finally {
      await app.close();
      delete process.env.MEDIA_ROOT;
      await rm(root, { recursive: true, force: true });
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
  async function photo() {
    return sharp({
      create: { width: 80, height: 60, channels: 3, background: '#ac5790' },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: 'private-fixture' } })
      .toBuffer();
  }
  function wav(seconds = 1) {
    const size = Math.ceil(seconds * 16000) * 2;
    const buffer = Buffer.alloc(44 + size);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + size, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24);
    buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(size, 40);
    for (let i = 0; i < size / 2; i++)
      buffer.writeInt16LE(Math.round(Math.sin(i * 0.1) * 10000), 44 + i * 2);
    return buffer;
  }
  async function upload(
    who: Account,
    id: string,
    type: 'image' | 'voice',
    bytes: Buffer,
    clientMessageId = randomUUID(),
    text = '',
  ) {
    const token = await csrf(who.client);
    return who.client
      .post(`${messagesUrl(id)}/${type}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .field('clientMessageId', clientMessageId)
      .field('text', text)
      .attach('file', bytes, {
        filename: 'untrusted.bin',
        contentType: 'application/octet-stream',
      });
  }

  it('sends private photos and two-frame GIFs with participant-only full and thumbnail access', async () => {
    const alice = await account({ isPrivate: true }),
      bob = await account(),
      eve = await account();
    const conversation = await open(alice, bob);
    const sent = await upload(alice, conversation.id, 'image', await photo());
    expect(sent.status).toBe(201);
    const message = DirectMessageResponseSchema.parse(sent.body).message;
    expect(message.text).toBe('');
    expect(message.attachment?.type).toBe('image');
    expect(sent.body.message).not.toHaveProperty('sourceHash');
    expect(sent.body.message).not.toHaveProperty('mediaId');
    if (message.attachment?.type !== 'image') throw new Error('Missing image');
    for (const url of [
      message.attachment.url,
      message.attachment.thumbnailUrl,
    ]) {
      const response = await bob.client.get(url).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await sharp(response.body).metadata()).exif).toBeUndefined();
      await eve.client.get(url).expect(404);
      await request(app.getHttpServer()).get(url).expect(401);
    }
    const mediaRow = await database.prisma.directMessage.findUniqueOrThrow({
      where: { id: message.id },
      select: { mediaId: true },
    });
    await bob.client.get(`/api/v1/media/${mediaRow.mediaId}/full`).expect(404);
    const frames = Buffer.concat([Buffer.alloc(48, 20), Buffer.alloc(48, 240)]);
    const gif = await sharp(frames, {
      raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
    })
      .gif({ delay: [100, 200], loop: 0 })
      .toBuffer();
    const reply = await upload(
      bob,
      conversation.id,
      'image',
      gif,
      randomUUID(),
      'GIF',
    );
    expect(reply.status).toBe(201);
    const animated = await alice.client
      .get(reply.body.message.attachment.url)
      .expect(200);
    expect((await sharp(animated.body).metadata()).pages).toBe(2);
    const other = await open(alice, eve);
    await alice.client
      .get(message.attachment.url.replace(conversation.id, other.id))
      .expect(404);
    expect(
      (await history(bob, conversation.id)).items.map((item) => item.id),
    ).toContain(message.id);
    const conversations = await list(bob);
    expect(
      conversations.items.find((item) => item.id === conversation.id)
        ?.lastMessage?.attachment?.type,
    ).toBe('image');
  });

  it('transcodes a voice message to M4A, measures duration, supports seeking and rejects unauthorized ranges', async () => {
    const alice = await account(),
      bob = await account(),
      eve = await account();
    const conversation = await open(alice, bob);
    const id = randomUUID();
    const sent = await upload(alice, conversation.id, 'voice', wav(), id);
    expect(sent.status).toBe(201);
    const message = DirectMessageResponseSchema.parse(sent.body).message;
    if (message.attachment?.type !== 'voice') throw new Error('Missing voice');
    expect(message.attachment.durationMs).toBe(1000);
    const file = await bob.client.get(message.attachment.url).expect(200);
    expect(file.headers['content-type']).toMatch(/^audio\/mp4/);
    expect(file.body.toString('ascii', 4, 8)).toBe('ftyp');
    const partial = await bob.client
      .get(message.attachment.url)
      .set('Range', 'bytes=0-15')
      .expect(206);
    expect(partial.body).toEqual(file.body.subarray(0, 16));
    expect(partial.headers['content-range']).toBe(
      `bytes 0-15/${file.body.length}`,
    );
    await bob.client
      .get(message.attachment.url)
      .set('Range', `bytes=${file.body.length}-`)
      .expect(416);
    await eve.client
      .get(message.attachment.url)
      .set('Range', 'bytes=0-15')
      .expect(404);
    await bob.client
      .get(message.attachment.url.replace(/audio$/, 'full'))
      .expect(404);
    const replay = await upload(alice, conversation.id, 'voice', wav(), id);
    expect(replay.body.message.id).toBe(message.id);
  });

  it('deduplicates concurrent file retries, rejects changed payloads and only emits one notice', async () => {
    const alice = await account(),
      bob = await account(),
      eve = await account();
    const conversation = await open(alice, bob);
    const image = await photo(),
      id = randomUUID();
    const notices = vi.spyOn(app.get(DirectEvents), 'notify');
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        upload(alice, conversation.id, 'image', image, id, 'caption'),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);
    expect(
      new Set(responses.map((response) => response.body.message.id)).size,
    ).toBe(1);
    const messageId = responses[0]!.body.message.id as string;
    expect(
      notices.mock.calls.filter(([, notice]) => notice.messageId === messageId),
    ).toHaveLength(1);
    notices.mockRestore();
    expect(
      await database.prisma.media.count({
        where: { ownerId: alice.id, kind: 'DIRECT' },
      }),
    ).toBe(1);
    expect(
      (await upload(alice, conversation.id, 'image', image, id, 'changed'))
        .status,
    ).toBe(409);
    expect(
      (
        await upload(
          alice,
          conversation.id,
          'image',
          Buffer.concat([image, Buffer.from('different')]),
          id,
          'caption',
        )
      ).status,
    ).toBe(409);
    expect(
      (await upload(alice, conversation.id, 'voice', image, id, 'caption'))
        .status,
    ).toBe(409);
    expect((await send(alice, conversation.id, 'caption', id)).status).toBe(
      409,
    );
    const other = await open(alice, eve);
    expect(
      (await upload(alice, other.id, 'image', image, id, 'caption')).status,
    ).toBe(409);
    const textId = randomUUID();
    expect(
      (await send(alice, conversation.id, 'text first', textId)).status,
    ).toBe(201);
    expect(
      (
        await upload(
          alice,
          conversation.id,
          'image',
          image,
          textId,
          'text first',
        )
      ).status,
    ).toBe(409);
  });

  it('rejects malformed, oversized, overlong and unauthorized uploads without persisting messages', async () => {
    const alice = await account(),
      bob = await account(),
      eve = await account(),
      unverified = await account({ verified: false });
    const conversation = await open(alice, bob);
    expect(
      (await upload(alice, conversation.id, 'image', Buffer.from('<svg/>')))
        .status,
    ).toBe(400);
    expect(
      (await upload(alice, conversation.id, 'voice', await photo())).status,
    ).toBe(400);
    expect(
      (await upload(alice, conversation.id, 'voice', wav(180.5))).status,
    ).toBe(400);
    expect(
      (
        await upload(
          alice,
          conversation.id,
          'voice',
          Buffer.alloc(10 * 1024 * 1024 + 1),
        )
      ).status,
    ).toBe(413);
    expect(
      (await upload(eve, conversation.id, 'image', await photo())).status,
    ).toBe(404);
    expect(
      (await upload(unverified, conversation.id, 'image', await photo()))
        .status,
    ).toBe(403);
    await alice.client
      .post(`${messagesUrl(conversation.id)}/image`)
      .attach('file', await photo(), 'photo.jpg')
      .expect(403);
    const token = await csrf(alice.client);
    await alice.client
      .post(`${messagesUrl(conversation.id)}/image`)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .field('clientMessageId', randomUUID())
      .expect(400);
    expect((await history(bob, conversation.id)).items).toEqual([]);
    expect(
      await database.prisma.media.count({
        where: { ownerId: alice.id, kind: 'DIRECT' },
      }),
    ).toBe(0);
  });

  it('stops serving deleted conversations immediately and sweeps orphan image and voice files', async () => {
    const alice = await account(),
      bob = await account();
    const conversation = await open(alice, bob);
    const image = await upload(alice, conversation.id, 'image', await photo());
    const voice = await upload(alice, conversation.id, 'voice', wav());
    expect(voice.status).toBe(201);
    await database.prisma.conversation.delete({
      where: { id: conversation.id },
    });
    await bob.client.get(image.body.message.attachment.url).expect(404);
    await bob.client.get(voice.body.message.attachment.url).expect(404);
    await app.get(MediaService).cleanup();
    expect(
      await database.prisma.media.count({
        where: { ownerId: alice.id, kind: 'DIRECT' },
      }),
    ).toBe(0);
  });
  it('keeps a committed attachment when notification fails and replays the lost response', async () => {
    const alice = await account(),
      bob = await account();
    const conversation = await open(alice, bob);
    const bytes = await photo(),
      id = randomUUID();
    const notices = vi
      .spyOn(app.get(DirectEvents), 'notify')
      .mockImplementationOnce(() => {
        throw new Error('Synthetic notification failure');
      });
    const first = await upload(alice, conversation.id, 'image', bytes, id);
    expect(first.status).toBe(500);
    notices.mockRestore();
    const replay = await upload(alice, conversation.id, 'image', bytes, id);
    expect(replay.status).toBe(201);
    await bob.client.get(replay.body.message.attachment.url).expect(200);
    expect((await history(bob, conversation.id)).items).toHaveLength(1);
  });
  async function source(who: Account, kind: 'post' | 'story' = 'post') {
    const token = await csrf(who.client);
    const response = await who.client
      .post(`/api/v1/${kind === 'post' ? 'posts' : 'stories'}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .attach('image', await photo(), 'source.jpg')
      .expect(201);
    return response.body[kind] as {
      id: string;
      image: { url: string };
      shareCount: number;
    };
  }
  async function share(
    who: Account,
    conversationId: string,
    kind: 'post' | 'story' | 'reel',
    contentId: string,
    clientMessageId = randomUUID(),
    text = '',
  ) {
    return post(who, `${messagesUrl(conversationId)}/share`, {
      clientMessageId,
      kind,
      contentId,
      text,
    });
  }

  it('shares originals with private previews, counts unique accounts across conversations and survives a lost response', async () => {
    const alice = await account(),
      bob = await account(),
      charlie = await account();
    const publication = await source(alice);
    const ab = await open(alice, bob),
      ac = await open(alice, charlie),
      bc = await open(bob, charlie);
    const id = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        share(alice, ab.id, 'post', publication.id, id),
      ),
    );
    expect(replies.map((item) => item.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);
    expect(new Set(replies.map((item) => item.body.message.id)).size).toBe(1);
    expect(ShareContentResponseSchema.parse(replies[0]!.body).shareCount).toBe(
      1,
    );
    const card = (await history(bob, ab.id)).items[0]!.sharedContent!;
    expect(card.status).toBe('available');
    if (card.status !== 'available') throw new Error('Missing card');
    expect(card.href).toBe(`/p/${publication.id}`);
    await bob.client.get(card.thumbnailUrl).expect(200);
    expect(
      (await share(alice, ac.id, 'post', publication.id)).body.shareCount,
    ).toBe(1);
    expect(
      (await share(bob, bc.id, 'post', publication.id)).body.shareCount,
    ).toBe(2);
    const state = await alice.client
      .get(`/api/v1/posts/${publication.id}`)
      .expect(200);
    expect(state.body.post.shareCount).toBe(2);
    expect(
      (await share(alice, ab.id, 'post', publication.id, id, 'changed')).status,
    ).toBe(409);
    expect((await send(alice, ab.id, 'ordinary text', id)).status).toBe(409);
    const textId = randomUUID();
    await send(alice, ab.id, 'text', textId);
    expect(
      (await share(alice, ab.id, 'post', publication.id, textId)).status,
    ).toBe(409);
    expect(
      await database.prisma.postShare.count({
        where: { postId: publication.id },
      }),
    ).toBe(2);
    const inbox = await list(bob);
    expect(
      inbox.items.find((item) => item.id === bc.id)?.lastMessage?.sharedContent
        ?.status,
    ).toBe('available');
  });

  it('never reveals private author, caption, media or links to an unauthorized recipient; revocation and deletion become tombstones', async () => {
    const owner = await account({ isPrivate: true }),
      allowed = await account(),
      denied = await account();
    await database.prisma.follow.create({
      data: {
        followerId: allowed.id,
        followeeId: owner.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });
    const publication = await source(owner),
      chat = await open(allowed, denied);
    const id = randomUUID();
    const sent = await share(allowed, chat.id, 'post', publication.id, id);
    expect(sent.status).toBe(201);
    const hidden = (await history(denied, chat.id)).items[0]!.sharedContent;
    expect(hidden).toEqual({ kind: 'post', status: 'unavailable' });
    expect((await list(denied)).items[0]!.lastMessage?.sharedContent).toEqual(
      hidden,
    );
    await denied.client.get(publication.image.url).expect(404);
    expect((await share(denied, chat.id, 'post', publication.id)).status).toBe(
      404,
    );
    await database.prisma.follow.deleteMany({
      where: { followerId: allowed.id, followeeId: owner.id },
    });
    expect((await history(allowed, chat.id)).items[0]!.sharedContent).toEqual(
      hidden,
    );
    const replay = await share(allowed, chat.id, 'post', publication.id, id);
    expect(replay.status).toBe(201);
    expect(replay.body.shareCount).toBeNull();
    await database.prisma.post.delete({ where: { id: publication.id } });
    expect((await history(allowed, chat.id)).items[0]!.sharedContent).toEqual(
      hidden,
    );
    expect(
      (await share(allowed, chat.id, 'post', publication.id, id)).status,
    ).toBe(201);
    expect(
      await database.prisma.postShare.count({
        where: { postId: publication.id },
      }),
    ).toBe(0);
  });

  it('shares an active story without extending its lifetime and hides expired and deleted history previews', async () => {
    const alice = await account(),
      bob = await account();
    const chat = await open(alice, bob),
      story = await source(alice, 'story');
    const id = randomUUID();
    expect((await share(alice, chat.id, 'story', story.id, id)).status).toBe(
      201,
    );
    const before = (await history(bob, chat.id)).items[0]!.sharedContent!;
    expect(before.status).toBe('available');
    expect(
      (await alice.client.get(`/api/v1/stories/${story.id}`)).body.story
        .shareCount,
    ).toBe(1);
    await database.prisma.story.update({
      where: { id: story.id },
      data: {
        createdAt: new Date(Date.now() - 90_000_000),
        expiresAt: new Date(Date.now() - 1),
      },
    });
    expect((await history(bob, chat.id)).items[0]!.sharedContent).toEqual({
      kind: 'story',
      status: 'unavailable',
    });
    if (before.status === 'available')
      await bob.client.get(before.thumbnailUrl).expect(404);
    expect((await share(alice, chat.id, 'story', story.id)).status).toBe(404);
    const replay = await share(alice, chat.id, 'story', story.id, id);
    expect(replay.status).toBe(201);
    expect(replay.body.shareCount).toBeNull();
    await database.prisma.story.delete({ where: { id: story.id } });
    expect((await history(bob, chat.id)).items[0]!.sharedContent).toEqual({
      kind: 'story',
      status: 'unavailable',
    });
  });

  it('uses the same unique counter for video post and reel and rejects photo-as-reel and unauthorized requests', async () => {
    const alice = await account(),
      bob = await account(),
      eve = await account();
    const chat = await open(alice, bob),
      publication = await source(alice);
    expect((await share(alice, chat.id, 'reel', publication.id)).status).toBe(
      404,
    );
    // Policy fixture: READY video metadata, not a video playback test.
    const media = await database.prisma.media.create({
      data: {
        ownerId: alice.id,
        kind: 'POST',
        type: 'VIDEO',
        state: 'READY',
        width: 64,
        height: 64,
        durationMs: 1000,
      },
    });
    const video = await database.prisma.post.create({
      data: {
        authorId: alice.id,
        mediaId: media.id,
        caption: 'Synthetic reel policy fixture',
      },
    });
    const first = await share(alice, chat.id, 'reel', video.id);
    expect(first.status).toBe(201);
    expect(first.body.message.sharedContent.kind).toBe('reel');
    expect(
      (await share(alice, chat.id, 'post', video.id)).body.shareCount,
    ).toBe(1);
    expect((await share(eve, chat.id, 'post', publication.id)).status).toBe(
      404,
    );
    await alice.client
      .post(`${messagesUrl(chat.id)}/share`)
      .send({
        clientMessageId: randomUUID(),
        kind: 'post',
        contentId: publication.id,
      })
      .expect(403);
    const bad = await post(alice, `${messagesUrl(chat.id)}/share`, {
      clientMessageId: randomUUID(),
      kind: 'post',
      contentId: publication.id,
      shareCount: 100,
    });
    expect(bad.status).toBe(400);
    expect(
      await database.prisma.postShare.count({
        where: { postId: publication.id },
      }),
    ).toBe(0);
  });

  it('rolls back both the message and unique-sharer journal when the sharing transaction fails', async () => {
    const alice = await account(),
      bob = await account();
    const chat = await open(alice, bob),
      publication = await source(alice);
    const { SharedContentService } =
      await import('../src/direct/shared-content.service.js');
    const service = app.get(SharedContentService),
      original = service.record.bind(service);
    const failure = vi
      .spyOn(service, 'record')
      .mockImplementationOnce(async (tx, userId, input) => {
        await original(tx, userId, input);
        throw new Error('Synthetic rollback after journal');
      });
    expect((await share(alice, chat.id, 'post', publication.id)).status).toBe(
      500,
    );
    failure.mockRestore();
    expect((await history(bob, chat.id)).items).toEqual([]);
    expect(
      await database.prisma.postShare.count({
        where: { postId: publication.id },
      }),
    ).toBe(0);
  });
});
