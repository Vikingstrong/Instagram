import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  JoinLiveResponseSchema,
  LiveCommentsResponseSchema,
  LiveListResponseSchema,
  LiveModeratorListResponseSchema,
  LiveResponseSchema,
  LiveRestrictionListResponseSchema,
  OptionalLiveResponseSchema,
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
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; device: string };

describe('Live moderation with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
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
    const events = app.get(DirectEvents);
    const notifyLive = events.notifyLive.bind(events);
    events.notifyLive = (userIds, notice) => {
      notices.push(userIds);
      notifyLive(userIds, notice);
    };
  }, 30_000);

  afterAll(async () => {
    try {
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
  async function account(coins?: number): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `m_${suffix.slice(0, 20)}`,
        password: 'synthetic moderation password',
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    expect(user.emailVerified).toBe(false);
    if (coins !== undefined)
      await database.prisma.coinWallet.create({
        data: { userId: user.id, balance: BigInt(coins) },
      });
    return { client, id: user.id, device: randomUUID() };
  }
  async function send(
    who: Account,
    method: 'post' | 'delete',
    url: string,
    body: object = {},
  ) {
    const token = await csrf(who.client);
    return who.client[method](url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  const url = (id: string, suffix = '') => `/api/v1/lives/${id}${suffix}`;
  const host = (id: string, suffix: string) =>
    `/api/v1/lives/hosts/${id}${suffix}`;
  async function start(owner: Account) {
    const response = await send(owner, 'post', livesEndpoints.start.path, {
      id: randomUUID(),
      clientId: owner.device,
    });
    expect(response.status).toBe(201);
    return LiveResponseSchema.parse(response.body).live;
  }
  const join = (who: Account, liveId: string) =>
    send(who, 'post', url(liveId, '/join'), { clientId: who.device });
  const comment = (who: Account, liveId: string, text: string) =>
    send(who, 'post', url(liveId, '/comments'), { id: randomUUID(), text });
  const restrict = (who: Account, hostId: string, body: object) =>
    send(who, 'post', host(hostId, '/restrictions'), body);

  it('lets only the host appoint moderators, and moderators act on viewers only', async () => {
    const owner = await account(),
      moderator = await account(),
      viewer = await account(),
      other = await account();
    expect(
      (
        await send(viewer, 'post', host(owner.id, '/moderators'), {
          userId: other.id,
        })
      ).body.error.code,
    ).toBe('LIVE_MODERATION_FORBIDDEN');
    const added = await send(owner, 'post', host(owner.id, '/moderators'), {
      userId: moderator.id,
    });
    expect(
      LiveModeratorListResponseSchema.parse(added.body).items.map((u) => u.id),
    ).toEqual([moderator.id]);
    expect(
      (await moderator.client.get(host(owner.id, '/moderators'))).status,
    ).toBe(403);

    const live = await start(owner);
    const own = LiveResponseSchema.parse(
      (await moderator.client.get(url(live.id))).body,
    );
    expect(own.live.viewer).toEqual({ role: 'moderator', muted: null });
    expect(
      LiveResponseSchema.parse((await owner.client.get(url(live.id))).body).live
        .viewer?.role,
    ).toBe('host');
    // A moderator mutes a viewer, but cannot touch the host or a moderator.
    expect(
      (
        await restrict(moderator, owner.id, {
          kind: 'mute',
          userId: viewer.id,
          minutes: 5,
        })
      ).status,
    ).toBe(200);
    expect(
      (await restrict(moderator, owner.id, { kind: 'ban', userId: owner.id }))
        .status,
    ).toBe(403);
    const second = await account();
    await send(owner, 'post', host(owner.id, '/moderators'), {
      userId: second.id,
    });
    expect(
      (
        await restrict(moderator, owner.id, {
          kind: 'mute',
          userId: second.id,
          minutes: null,
        })
      ).body.error.code,
    ).toBe('LIVE_MODERATION_FORBIDDEN');
    expect(
      (
        await restrict(viewer, owner.id, {
          kind: 'mute',
          userId: other.id,
          minutes: 5,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await restrict(owner, owner.id, {
          kind: 'mute',
          userId: viewer.id,
          minutes: 7,
        })
      ).status,
    ).toBe(400);
    const list = LiveRestrictionListResponseSchema.parse(
      (await moderator.client.get(host(owner.id, '/restrictions'))).body,
    );
    expect(list.items).toEqual([
      expect.objectContaining({
        kind: 'mute',
        user: expect.objectContaining({ id: viewer.id }),
      }),
    ]);
    // Removing the role takes the rights away.
    await send(owner, 'delete', host(owner.id, `/moderators/${moderator.id}`));
    expect(
      (
        await restrict(moderator, owner.id, {
          kind: 'mute',
          userId: other.id,
          minutes: 5,
        })
      ).status,
    ).toBe(403);
  }, 60_000);

  it('mutes chat and gifts for a while or for good, and the mute can be lifted', async () => {
    const owner = await account(),
      viewer = await account(50);
    const live = await start(owner);
    expect((await comment(viewer, live.id, 'before')).status).toBe(201);
    await restrict(owner, owner.id, {
      kind: 'mute',
      userId: viewer.id,
      minutes: 60,
    });
    const muted = await comment(viewer, live.id, 'muted');
    expect(muted.status).toBe(403);
    expect(muted.body.error.code).toBe('LIVE_MUTED');
    const gift = await send(viewer, 'post', url(live.id, '/gifts'), {
      id: randomUUID(),
      giftKey: 'rose',
    });
    expect(gift.body.error.code).toBe('LIVE_MUTED');
    const access = LiveResponseSchema.parse(
      (await viewer.client.get(url(live.id))).body,
    ).live.viewer!;
    expect(access.role).toBe('viewer');
    expect(Date.parse(access.muted!.until!)).toBeGreaterThan(
      Date.now() + 50 * 60_000,
    );
    // Watching still works.
    expect((await join(viewer, live.id)).status).toBe(200);

    // An expired mute has no effect without any cleanup.
    await database.prisma.liveRestriction.updateMany({
      where: { hostId: owner.id, userId: viewer.id },
      data: { until: new Date(Date.now() - 1000) },
    });
    expect((await comment(viewer, live.id, 'free again')).status).toBe(201);

    await restrict(owner, owner.id, {
      kind: 'mute',
      userId: viewer.id,
      minutes: null,
    });
    expect(
      LiveResponseSchema.parse((await viewer.client.get(url(live.id))).body)
        .live.viewer!.muted,
    ).toEqual({ until: null });
    expect(
      (
        await send(
          owner,
          'delete',
          host(owner.id, `/restrictions/${viewer.id}/mute`),
        )
      ).status,
    ).toBe(200);
    expect((await comment(viewer, live.id, 'unmuted')).status).toBe(201);
    expect(
      await database.prisma.coinWallet.findUnique({
        where: { userId: viewer.id },
      }),
    ).toMatchObject({
      balance: 50n,
    });
  }, 60_000);

  it('bans: hides the host streams, disconnects at once and removes the chat lines', async () => {
    const owner = await account(),
      viewer = await account(),
      friend = await account();
    await database.prisma.follow.create({
      data: {
        followerId: viewer.id,
        followeeId: owner.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });
    const live = await start(owner);
    JoinLiveResponseSchema.parse((await join(viewer, live.id)).body);
    await comment(viewer, live.id, 'spam');
    await comment(friend, live.id, 'hello');
    notices = [];
    expect(
      (await restrict(owner, owner.id, { kind: 'ban', userId: viewer.id }))
        .status,
    ).toBe(200);
    // Told over SSE, disconnected, and every stream request now says why.
    expect(notices.some((ids) => ids.includes(viewer.id))).toBe(true);
    expect(
      LiveResponseSchema.parse((await owner.client.get(url(live.id))).body).live
        .viewerCount,
    ).toBe(0);
    for (const response of [
      await viewer.client.get(url(live.id)),
      await send(viewer, 'post', url(live.id, '/heartbeat'), {
        clientId: viewer.device,
      }),
      await join(viewer, live.id),
      await viewer.client.get(url(live.id, '/comments')),
      await comment(viewer, live.id, 'again'),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('LIVE_BANNED');
    }
    const lines = LiveCommentsResponseSchema.parse(
      (await owner.client.get(url(live.id, '/comments'))).body,
    ).items.map((item) => item.text);
    expect(lines).toEqual(['hello']);
    // Not listed and not revealed on the profile, despite the follow.
    expect(
      LiveListResponseSchema.parse(
        (await viewer.client.get(livesEndpoints.list.path)).body,
      ).items.map((item) => item.id),
    ).not.toContain(live.id);
    expect(
      OptionalLiveResponseSchema.parse(
        (await viewer.client.get(`/api/v1/lives/host/${owner.id}`)).body,
      ).live,
    ).toBeNull();
    // The ban outlives this stream; lifting it restores access.
    await send(owner, 'post', url(live.id, '/end'));
    const next = await start(owner);
    expect((await viewer.client.get(url(next.id))).body.error.code).toBe(
      'LIVE_BANNED',
    );
    expect(
      (
        await send(
          owner,
          'delete',
          host(owner.id, `/restrictions/${viewer.id}/ban`),
        )
      ).status,
    ).toBe(200);
    expect((await join(viewer, next.id)).status).toBe(200);
    // Appointing a moderator lifts their restrictions.
    await restrict(owner, owner.id, { kind: 'ban', userId: friend.id });
    await send(owner, 'post', host(owner.id, '/moderators'), {
      userId: friend.id,
    });
    expect((await friend.client.get(url(next.id))).status).toBe(200);
  }, 60_000);
});
