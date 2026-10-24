import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  CoinTransactionsResponseSchema,
  LiveGiftsResponseSchema,
  LiveResponseSchema,
  SendLiveGiftResponseSchema,
  authEndpoints,
  livesEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { CALLS_CONFIG, readCallsConfig } from '../src/calls/calls.config.js';
import { DirectEvents } from '../src/direct/direct-events.js';
import { LivesService } from '../src/lives/lives.service.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string };

describe('Live gifts with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let lives: LivesService;
  let notices: string[][] = [];
  const ownedIds: string[] = [];

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(CALLS_CONFIG)
      .useValue(readCallsConfig({ NODE_ENV: 'test' }))
      .overrideProvider(AuthRateLimiter)
      .useValue({ consume: () => undefined })
      .compile();
    app = fixture.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    lives = app.get(LivesService);
    const events = app.get(DirectEvents);
    const notifyLive = events.notifyLive.bind(events);
    events.notifyLive = (userIds, notice) => {
      notices.push(userIds);
      notifyLive(userIds, notice);
    };
  }, 30_000);

  afterAll(async () => {
    try {
      // Money records restrict user deletion: remove the test ones first.
      const ids = { in: ownedIds };
      await database.prisma.liveGift.deleteMany({ where: { senderId: ids } });
      await database.prisma.coinOperation.deleteMany({
        where: { OR: [{ senderId: ids }, { recipientId: ids }] },
      });
      await database.prisma.user.deleteMany({ where: { id: ids } });
    } finally {
      await app.close();
    }
  });

  async function csrf(client: Agent): Promise<string> {
    const response = await client.get(authEndpoints.csrf.path).expect(200);
    return AuthCsrfResponseSchema.parse(response.body).csrfToken;
  }
  async function account(
    options: { isPrivate?: boolean; coins?: number } = {},
  ): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `g_${suffix.slice(0, 20)}`,
        password: 'synthetic gift password',
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    expect(user.emailVerified).toBe(false);
    await database.prisma.user.update({
      where: { id: user.id },
      data: {
        isPrivate: options.isPrivate ?? false,
      },
    });
    if (options.coins !== undefined)
      await database.prisma.coinWallet.create({
        data: { userId: user.id, balance: BigInt(options.coins) },
      });
    return { client, id: user.id };
  }
  async function post(who: Account, url: string, body: object = {}) {
    const token = await csrf(who.client);
    return who.client
      .post(url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  const url = (id: string, suffix = '') => `/api/v1/lives/${id}${suffix}`;
  async function start(host: Account) {
    const response = await post(host, livesEndpoints.start.path, {
      id: randomUUID(),
      clientId: randomUUID(),
    });
    expect(response.status).toBe(201);
    return LiveResponseSchema.parse(response.body).live;
  }
  const gift = (
    who: Account,
    liveId: string,
    giftKey: string,
    id = randomUUID(),
  ) => post(who, url(liveId, '/gifts'), { id, giftKey });
  const balance = async (who: Account) =>
    (await database.prisma.coinWallet.findUnique({ where: { userId: who.id } }))
      ?.balance ?? 0n;

  it('moves the catalog price from the viewer to the host and shows the gift to the stream', async () => {
    const host = await account(),
      viewer = await account({ coins: 100 });
    const live = await start(host);
    notices = [];
    const response = await gift(viewer, live.id, 'pumpkin');
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const sent = SendLiveGiftResponseSchema.parse(response.body);
    expect(sent.gift).toMatchObject({
      giftKey: 'pumpkin',
      price: 50,
      sender: expect.objectContaining({ id: viewer.id }),
    });
    expect(sent.balance).toBe('50');
    expect(await balance(viewer)).toBe(50n);
    expect(await balance(host)).toBe(50n);
    expect(notices.some((ids) => ids.includes(host.id))).toBe(true);
    // The gift and the transfer are one record pair.
    const operation = await database.prisma.coinOperation.findUniqueOrThrow({
      where: { id: sent.gift.id },
    });
    expect(operation).toMatchObject({
      senderId: viewer.id,
      recipientId: host.id,
      amount: 50n,
      streamId: live.id,
      giftKey: 'pumpkin',
    });
    for (const who of [host, viewer]) {
      const list = LiveGiftsResponseSchema.parse(
        (await who.client.get(url(live.id, '/gifts'))).body,
      );
      expect(list.items.map((item) => item.id)).toEqual([sent.gift.id]);
      expect(
        LiveGiftsResponseSchema.parse(
          (
            await who.client
              .get(url(live.id, '/gifts'))
              .query({ after: list.next })
          ).body,
        ).items,
      ).toEqual([]);
    }
    const history = CoinTransactionsResponseSchema.parse(
      (await host.client.get('/api/v1/coins/transactions')).body,
    );
    expect(history.items[0]).toMatchObject({
      kind: 'gift_received',
      amount: '50',
      gift: { streamId: live.id, giftKey: 'pumpkin' },
    });
    // The client never names a price or a recipient.
    expect(
      (
        await post(viewer, url(live.id, '/gifts'), {
          id: randomUUID(),
          giftKey: 'rose',
          price: 0,
        })
      ).status,
    ).toBe(400);
    expect((await gift(viewer, live.id, 'diamond')).status).toBe(400);
    expect(
      (
        await viewer.client
          .post(url(live.id, '/gifts'))
          .set('Origin', origin)
          .send({ id: randomUUID(), giftKey: 'rose' })
      ).status,
    ).toBe(403);
  }, 30_000);

  it('charges a retried gift once, even after the stream ended', async () => {
    const host = await account(),
      viewer = await account({ coins: 20 });
    const live = await start(host);
    const id = randomUUID();
    const first = SendLiveGiftResponseSchema.parse(
      (await gift(viewer, live.id, 'instagram', id)).body,
    );
    const again = await gift(viewer, live.id, 'instagram', id);
    expect(again.status).toBe(201);
    expect(SendLiveGiftResponseSchema.parse(again.body).gift.id).toBe(
      first.gift.id,
    );
    expect(await balance(viewer)).toBe(10n);
    const other = await gift(viewer, live.id, 'rose', id);
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('COINS_OPERATION_CONFLICT');
    expect((await post(host, url(live.id, '/end'))).status).toBe(200);
    const late = await gift(viewer, live.id, 'instagram', id);
    expect(late.status).toBe(201);
    expect(SendLiveGiftResponseSchema.parse(late.body).gift.id).toBe(
      first.gift.id,
    );
    expect((await gift(viewer, live.id, 'rose')).body.error.code).toBe(
      'LIVE_ENDED',
    );
    expect(await balance(viewer)).toBe(10n);
    expect(await balance(host)).toBe(10n);
    // A stream with gifts outlives the cleanup of ended streams.
    await database.prisma.live.update({
      where: { id: live.id },
      data: { endedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    await lives.sweep();
    expect(await database.prisma.live.count({ where: { id: live.id } })).toBe(
      1,
    );
  }, 30_000);

  it('refuses without coins, access or a live stream, and never charges', async () => {
    const host = await account({ isPrivate: true }),
      follower = await account({ coins: 4 }),
      stranger = await account({ coins: 100 });
    await database.prisma.follow.create({
      data: {
        followerId: follower.id,
        followeeId: host.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });
    const live = await start(host);
    const poor = await gift(follower, live.id, 'glasses');
    expect(poor.status).toBe(409);
    expect(poor.body.error.code).toBe('COINS_INSUFFICIENT_BALANCE');
    expect((await gift(stranger, live.id, 'rose')).status).toBe(404);
    expect((await gift(host, live.id, 'rose')).body.error.code).toBe(
      'LIVE_STATE_CONFLICT',
    );
    expect((await stranger.client.get(url(live.id, '/gifts'))).status).toBe(
      404,
    );
    expect((await gift(follower, live.id, 'heart')).status).toBe(201);
    expect(await balance(follower)).toBe(1n);
    expect(await balance(stranger)).toBe(100n);
    expect(await balance(host)).toBe(3n);
    expect(
      await database.prisma.liveGift.count({ where: { liveId: live.id } }),
    ).toBe(1);
  }, 30_000);

  it('keeps balances exact under concurrent gifts, retries and the end of the stream', async () => {
    const host = await account(),
      viewer = await account({ coins: 100 });
    const live = await start(host);
    const distinct = await Promise.all(
      Array.from({ length: 5 }, () => gift(viewer, live.id, 'rose')),
    );
    expect(distinct.map((response) => response.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);
    const id = randomUUID();
    const same = await Promise.all(
      Array.from({ length: 3 }, () => gift(viewer, live.id, 'glasses', id)),
    );
    expect(same.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(
      new Set(
        same.map(
          (response) => SendLiveGiftResponseSchema.parse(response.body).gift.id,
        ),
      ).size,
    ).toBe(1);
    expect(await balance(viewer)).toBe(90n);

    // A gift racing the end is either in the stream and paid, or refused.
    const [late] = await Promise.all([
      gift(viewer, live.id, 'heart'),
      post(host, url(live.id, '/end')),
    ]);
    expect([201, 409]).toContain(late!.status);
    const gifts = await database.prisma.liveGift.findMany({
      where: { liveId: live.id },
    });
    const paid = gifts.reduce((sum, row) => sum + row.price, 0);
    expect(await balance(host)).toBe(BigInt(paid));
    expect(await balance(viewer)).toBe(BigInt(100 - paid));
    expect(
      await database.prisma.coinOperation.count({
        where: { streamId: live.id },
      }),
    ).toBe(gifts.length);
  }, 60_000);
});
