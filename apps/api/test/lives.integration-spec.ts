import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  JoinLiveResponseSchema,
  LiveCommentResponseSchema,
  LiveCommentsResponseSchema,
  LiveListResponseSchema,
  LiveResponseSchema,
  LiveSignalsResponseSchema,
  OptionalLiveResponseSchema,
  authEndpoints,
  livesEndpoints,
  socialEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { CALLS_CONFIG, readCallsConfig } from '../src/calls/calls.config.js';
import { DirectEvents } from '../src/direct/direct-events.js';
import {
  LIVES_CONFIG,
  LivesService,
  defaultLivesConfig,
} from '../src/lives/lives.service.js';
import type { LiveRooms } from '../src/lives/live-rooms.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const password = 'synthetic live password';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; device: string };
const offer = { type: 'offer', sdp: 'v=0 synthetic offer' } as const;
const answer = { type: 'answer', sdp: 'v=0 synthetic answer' } as const;
const ice = {
  type: 'ice',
  candidate: { candidate: 'synthetic', sdpMid: '0', sdpMLineIndex: 0 },
} as const;

describe('Live streams with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let lives: LivesService;
  let notices: { userIds: string[]; liveId: string }[] = [];
  const ownedIds: string[] = [];

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(CALLS_CONFIG)
      .useValue(readCallsConfig({ NODE_ENV: 'test' }))
      .overrideProvider(LIVES_CONFIG)
      .useValue({ ...defaultLivesConfig, maxViewers: 2 })
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
      notices.push({ userIds, liveId: notice.liveId });
      notifyLive(userIds, notice);
    };
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
    options: { isPrivate?: boolean } = {},
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
        username: `l_${suffix.slice(0, 20)}`,
        password,
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
  const followed = (follower: Account, host: Account) =>
    database.prisma.follow.create({
      data: {
        followerId: follower.id,
        followeeId: host.id,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });
  async function start(host: Account, id: string = randomUUID()) {
    const response = await send(host, 'post', livesEndpoints.start.path, {
      id,
      clientId: host.device,
    });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    return LiveResponseSchema.parse(response.body).live;
  }
  async function join(viewer: Account, liveId: string) {
    const response = await send(viewer, 'post', url(liveId, '/join'), {
      clientId: viewer.device,
    });
    expect(response.status).toBe(200);
    return JoinLiveResponseSchema.parse(response.body);
  }
  const signal = (
    who: Account,
    liveId: string,
    peerId: string,
    value: object,
    clientId = who.device,
  ) =>
    send(who, 'post', url(liveId, '/signals'), {
      clientId,
      peerId,
      signal: value,
    });
  const read = (who: Account, liveId: string, after = 0) =>
    who.client.get(url(liveId, '/signals')).query({
      clientId: who.device,
      after,
    });
  const heartbeat = (who: Account, liveId: string) =>
    send(who, 'post', url(liveId, '/heartbeat'), { clientId: who.device });
  const comment = (
    who: Account,
    liveId: string,
    text: string,
    id = randomUUID(),
  ) => send(who, 'post', url(liveId, '/comments'), { id, text });
  const rooms = () => (lives as unknown as { rooms: LiveRooms }).rooms;

  it('accepts a session without email verification, requires Origin/CSRF and rejects forged input', async () => {
    const host = await account(),
      newAccount = await account();
    const anonymous = request(app.getHttpServer());
    expect((await anonymous.get(livesEndpoints.list.path)).status).toBe(401);
    expect((await newAccount.client.get(livesEndpoints.list.path)).status).toBe(
      200,
    );
    expect(
      (
        await host.client
          .post(livesEndpoints.start.path)
          .set('Origin', origin)
          .send({ id: randomUUID(), clientId: host.device })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(host, 'post', livesEndpoints.start.path, {
          id: randomUUID(),
          clientId: host.device,
          hostId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect((await host.client.get(url('not-a-uuid'))).status).toBe(400);
    expect((await host.client.get(url(randomUUID()))).status).toBe(404);
  }, 30_000);

  it('starts idempotently, one stream per host, and lists it to followers only', async () => {
    const host = await account(),
      follower = await account(),
      stranger = await account();
    await followed(follower, host);
    notices = [];
    const id = randomUUID();
    const live = await start(host, id);
    expect(live).toMatchObject({ id, status: 'LIVE', viewerCount: 0 });
    expect(live.host.id).toBe(host.id);
    // Followers learn about the start over SSE.
    expect(
      notices.some((n) => n.liveId === id && n.userIds.includes(follower.id)),
    ).toBe(true);
    expect((await start(host, id)).id).toBe(id);
    const busy = await send(host, 'post', livesEndpoints.start.path, {
      id: randomUUID(),
      clientId: host.device,
    });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('LIVE_BUSY');
    // Someone else's id cannot be taken over.
    const stolen = await send(stranger, 'post', livesEndpoints.start.path, {
      id,
      clientId: stranger.device,
    });
    expect(stolen.body.error.code).toBe('LIVE_STATE_CONFLICT');

    const current = await host.client.get(livesEndpoints.current.path);
    expect(OptionalLiveResponseSchema.parse(current.body).live?.id).toBe(id);
    const listed = async (who: Account) =>
      LiveListResponseSchema.parse(
        (await who.client.get(livesEndpoints.list.path)).body,
      ).items.map((item) => item.id);
    expect(await listed(follower)).toContain(id);
    expect(await listed(host)).toContain(id);
    expect(await listed(stranger)).not.toContain(id);
    // A public account's stream is open to anyone who opens the profile.
    const byHost = await stranger.client.get(`/api/v1/lives/host/${host.id}`);
    expect(OptionalLiveResponseSchema.parse(byHost.body).live?.id).toBe(id);
    expect((await stranger.client.get(url(id))).status).toBe(200);
  }, 30_000);

  it('keeps a private stream, its chat and signals from strangers', async () => {
    const host = await account({ isPrivate: true }),
      stranger = await account(),
      pending = await account();
    await database.prisma.follow.create({
      data: { followerId: pending.id, followeeId: host.id, status: 'PENDING' },
    });
    const live = await start(host);
    for (const who of [stranger, pending]) {
      const byHost = await who.client.get(`/api/v1/lives/host/${host.id}`);
      expect(byHost.body).toEqual({ live: null });
      expect((await who.client.get(url(live.id))).status).toBe(404);
      expect(
        (
          await send(who, 'post', url(live.id, '/join'), {
            clientId: who.device,
          })
        ).body.error.code,
      ).toBe('LIVE_NOT_FOUND');
      expect((await who.client.get(url(live.id, '/comments'))).status).toBe(
        404,
      );
      expect((await comment(who, live.id, 'hello')).status).toBe(404);
      expect((await read(who, live.id)).status).toBe(404);
    }
  }, 30_000);

  it('relays offer, answer and ICE between the host and one bound viewer peer', async () => {
    const host = await account(),
      viewer = await account();
    const live = await start(host);
    const joined = await join(viewer, live.id);
    expect(joined.live.viewerCount).toBe(1);
    const peerId = joined.peerId;
    // Roles: viewers offer, the host answers; devices are bound.
    expect((await signal(viewer, live.id, peerId, answer)).status).toBe(409);
    expect((await signal(host, live.id, peerId, offer)).status).toBe(409);
    expect(
      (await signal(viewer, live.id, peerId, offer, randomUUID())).status,
    ).toBe(409);
    expect((await signal(viewer, live.id, randomUUID(), offer)).status).toBe(
      409,
    );
    expect(
      (await signal(host, live.id, peerId, answer, randomUUID())).status,
    ).toBe(409);
    expect((await signal(viewer, live.id, peerId, offer)).status).toBe(200);
    expect((await signal(viewer, live.id, peerId, ice)).status).toBe(200);

    const inbox = LiveSignalsResponseSchema.parse(
      (await read(host, live.id)).body,
    );
    expect(inbox.items.map((item) => [item.peerId, item.signal.type])).toEqual([
      [peerId, 'offer'],
      [peerId, 'ice'],
    ]);
    expect(inbox.peers).toEqual([
      expect.objectContaining({
        peerId,
        user: expect.objectContaining({ id: viewer.id }),
      }),
    ]);
    // The cursor acknowledges what was read.
    expect(
      LiveSignalsResponseSchema.parse(
        (await read(host, live.id, inbox.next)).body,
      ).items,
    ).toEqual([]);
    expect((await signal(host, live.id, peerId, answer)).status).toBe(200);
    const back = LiveSignalsResponseSchema.parse(
      (await read(viewer, live.id)).body,
    );
    expect(back.items.map((item) => item.signal.type)).toEqual(['answer']);
    expect(back.peers).toEqual([]);

    // A second tab replaces the first connection.
    const tab = { ...viewer, device: randomUUID() };
    const again = await join(tab, live.id);
    expect(again.peerId).not.toBe(peerId);
    expect(again.live.viewerCount).toBe(1);
    expect((await heartbeat(viewer, live.id)).status).toBe(409);
    expect((await heartbeat(tab, live.id)).status).toBe(200);
    // The host cannot watch its own stream.
    expect(
      (
        await send(host, 'post', url(live.id, '/join'), {
          clientId: host.device,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(tab, 'post', url(live.id, '/leave'), {
          clientId: tab.device,
        })
      ).status,
    ).toBe(200);
    expect(
      LiveSignalsResponseSchema.parse((await read(host, live.id)).body).peers,
    ).toEqual([]);
  }, 30_000);

  it('limits concurrent viewers', async () => {
    const host = await account(),
      viewers = [await account(), await account(), await account()];
    const live = await start(host);
    await join(viewers[0]!, live.id);
    await join(viewers[1]!, live.id);
    const full = await send(viewers[2]!, 'post', url(live.id, '/join'), {
      clientId: viewers[2]!.device,
    });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('LIVE_FULL');
    expect(
      LiveResponseSchema.parse((await host.client.get(url(live.id))).body).live
        .viewerCount,
    ).toBe(2);
  }, 60_000);

  it('disconnects a former follower during the stream', async () => {
    const host = await account({ isPrivate: true }),
      removed = await account(),
      leaving = await account();
    await followed(removed, host);
    await followed(leaving, host);
    const live = await start(host);
    await join(removed, live.id);
    await join(leaving, live.id);
    expect((await comment(removed, live.id, 'before')).status).toBe(201);

    // The host removes one follower, the other unfollows.
    expect(
      (await send(host, 'delete', `/api/v1/me/followers/${removed.id}`)).status,
    ).toBe(200);
    expect(
      (
        await send(
          leaving,
          'delete',
          socialEndpoints.unfollow.path.replace('{id}', host.id),
        )
      ).status,
    ).toBe(200);
    // The sweep re-checks connected viewers even if they stay silent.
    await lives.sweep();
    expect(
      LiveSignalsResponseSchema.parse((await read(host, live.id)).body).peers,
    ).toEqual([]);
    for (const who of [removed, leaving]) {
      expect((await heartbeat(who, live.id)).status).toBe(404);
      expect((await who.client.get(url(live.id, '/comments'))).status).toBe(
        404,
      );
      expect((await comment(who, live.id, 'after')).status).toBe(404);
    }
  }, 60_000);

  it('keeps an idempotent, bounded chat that disappears with the stream', async () => {
    const host = await account(),
      viewer = await account();
    const live = await start(host);
    const id = randomUUID();
    const first = await comment(viewer, live.id, 'Привет!', id);
    expect(first.status).toBe(201);
    expect(LiveCommentResponseSchema.parse(first.body).comment).toMatchObject({
      id,
      text: 'Привет!',
      author: expect.objectContaining({ id: viewer.id }),
    });
    expect((await comment(viewer, live.id, 'Привет!', id)).status).toBe(201);
    expect((await comment(viewer, live.id, 'other', id)).body.error.code).toBe(
      'MESSAGE_ID_CONFLICT',
    );
    expect((await comment(viewer, live.id, '   ')).status).toBe(400);
    expect((await comment(viewer, live.id, 'x'.repeat(301))).status).toBe(400);
    expect((await comment(viewer, live.id, 'two\nlines')).status).toBe(400);
    expect((await comment(host, live.id, 'from host')).status).toBe(201);

    const latest = LiveCommentsResponseSchema.parse(
      (await viewer.client.get(url(live.id, '/comments'))).body,
    );
    expect(latest.items.map((item) => item.text)).toEqual([
      'Привет!',
      'from host',
    ]);
    const later = LiveCommentsResponseSchema.parse(
      (
        await viewer.client
          .get(url(live.id, '/comments'))
          .query({ after: latest.next })
      ).body,
    );
    expect(later).toEqual({ items: [], next: latest.next });
    expect(
      (await viewer.client.get(url(live.id, '/comments')).query({ after: '!' }))
        .status,
    ).toBe(400);

    await join(viewer, live.id);
    expect((await send(viewer, 'post', url(live.id, '/end'))).status).toBe(409);
    const ended = await send(host, 'post', url(live.id, '/end'));
    expect(LiveResponseSchema.parse(ended.body).live.status).toBe('ENDED');
    expect(
      await database.prisma.liveComment.count({ where: { liveId: live.id } }),
    ).toBe(0);
    expect(
      LiveResponseSchema.parse((await viewer.client.get(url(live.id))).body)
        .live,
    ).toMatchObject({ status: 'ENDED', viewerCount: 0 });
    expect(
      LiveResponseSchema.parse((await heartbeat(viewer, live.id)).body).live
        .status,
    ).toBe('ENDED');
    expect((await comment(viewer, live.id, 'late')).body.error.code).toBe(
      'LIVE_ENDED',
    );
    expect(
      (
        await send(viewer, 'post', url(live.id, '/join'), {
          clientId: viewer.device,
        })
      ).body.error.code,
    ).toBe('LIVE_ENDED');
    expect((await read(host, live.id)).body.error.code).toBe('LIVE_ENDED');
    expect(
      OptionalLiveResponseSchema.parse(
        (await host.client.get(livesEndpoints.current.path)).body,
      ).live,
    ).toBeNull();
    // The host may go live again.
    await start(host);
  }, 30_000);

  it('ends silent, overlong and signed-out streams and drops silent viewers', async () => {
    const host = await account(),
      viewer = await account();
    const lost = await start(host);
    await database.prisma.live.update({
      where: { id: lost.id },
      data: { hostSeenAt: new Date(Date.now() - 30_000) },
    });
    await lives.sweep();
    expect(
      await database.prisma.live.findUniqueOrThrow({ where: { id: lost.id } }),
    ).toMatchObject({ status: 'ENDED', endReason: 'LOST', activeHostId: null });

    const long = await start(host);
    await database.prisma.live.update({
      where: { id: long.id },
      data: { startedAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    await lives.sweep();
    expect(
      (await database.prisma.live.findUniqueOrThrow({ where: { id: long.id } }))
        .endReason,
    ).toBe('TIME_LIMIT');

    const live = await start(host);
    const joined = await join(viewer, live.id);
    const peer = rooms()
      .viewers(live.id)
      .find((item) => item.peerId === joined.peerId)!;
    peer.seenAt = Date.now() - 30_000;
    await lives.sweep();
    expect(rooms().count(live.id)).toBe(0);
    expect((await heartbeat(viewer, live.id)).status).toBe(409);

    // Logging out of the viewer's session disconnects it at once.
    await join(viewer, live.id);
    expect((await send(viewer, 'post', authEndpoints.logout.path)).status).toBe(
      200,
    );
    expect(rooms().count(live.id)).toBe(0);

    // The host's logout ends the stream.
    expect((await heartbeat(host, live.id)).status).toBe(200);
    expect((await send(host, 'post', authEndpoints.logout.path)).status).toBe(
      200,
    );
    await expect
      .poll(
        async () =>
          (
            await database.prisma.live.findUniqueOrThrow({
              where: { id: live.id },
            })
          ).endReason,
      )
      .toBe('SIGNED_OUT');
  }, 60_000);
});
