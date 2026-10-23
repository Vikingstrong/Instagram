import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  ConversationResponseSchema,
  authEndpoints,
  directEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { CallsService } from '../src/calls/calls.service.js';
import { CALLS_CONFIG, readCallsConfig } from '../src/calls/calls.config.js';
import {
  CallResponseSchema,
  CallHistoryResponseSchema,
  callsEndpoints,
} from '@instagram/contracts';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const password = 'synthetic direct password';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; email: string };
describe('Calls with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let calls: CallsService;
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
    calls = app.get(CallsService);
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
  const device = new Map<string, string>();
  const clientId = (who: Account) => {
    let id = device.get(who.id);
    if (!id) {
      id = randomUUID();
      device.set(who.id, id);
    }
    return id;
  };
  const url = (id: string, suffix = '') => `/api/v1/calls/${id}${suffix}`;
  async function start(
    who: Account,
    conversationId: string,
    kind: 'AUDIO' | 'VIDEO' = 'AUDIO',
    id: string = randomUUID(),
  ) {
    const response = await post(who, callsEndpoints.start.path, {
      id,
      conversationId,
      kind,
      clientId: clientId(who),
    });
    expect(response.status).toBe(201);
    return CallResponseSchema.parse(response.body).call;
  }
  const action = (
    who: Account,
    id: string,
    action: 'accept' | 'decline' | 'end' | 'fail',
    deviceId = clientId(who),
  ) => post(who, url(id, '/action'), { action, clientId: deviceId });
  const signal = (who: Account, id: string, signal: object) =>
    post(who, url(id, '/signals'), { clientId: clientId(who), signal });
  const signals = (who: Account, id: string, after = 0) =>
    who.client.get(
      url(id, `/signals?clientId=${clientId(who)}&after=${after}`),
    );

  it('requires verified sessions, Origin/CSRF and rejects forged data', async () => {
    expect(
      (await request(app.getHttpServer()).get(callsEndpoints.current.path))
        .status,
    ).toBe(401);
    const unverified = await account({ verified: false });
    expect(
      (await unverified.client.get(callsEndpoints.current.path)).status,
    ).toBe(403);
    const first = await account(),
      second = await account();
    const conversation = await open(first, second);
    expect(
      (await first.client.post(callsEndpoints.start.path).send({})).status,
    ).toBe(403);
    expect(
      (
        await post(first, callsEndpoints.start.path, {
          id: randomUUID(),
          conversationId: conversation.id,
          clientId: clientId(first),
          kind: 'AUDIO',
          callerId: second.id,
        })
      ).status,
    ).toBe(400);
    const csrfToken = await csrf(first.client);
    expect(
      (
        await first.client
          .post(callsEndpoints.start.path)
          .set('Origin', 'https://evil.example')
          .set('X-CSRF-Token', csrfToken)
          .send({})
      ).status,
    ).toBe(403);
    expect((await first.client.get(callsEndpoints.config.path)).body).toEqual({
      iceServers: [],
    });
  });

  it('starts idempotently, binds signal access to participants and the owning session/device', async () => {
    const first = await account(),
      second = await account(),
      stranger = await account();
    const conversation = await open(first, second);
    const call = await start(first, conversation.id, 'VIDEO');
    expect(await start(first, conversation.id, 'VIDEO', call.id)).toEqual(call);
    expect(
      (await second.client.get(callsEndpoints.current.path)).body.call,
    ).toMatchObject({
      id: call.id,
      callerId: first.id,
      peer: { id: first.id },
      status: 'RINGING',
    });
    expect((await stranger.client.get(url(call.id))).status).toBe(404);
    expect(
      (await stranger.client.get(`/api/v1/calls/history/${conversation.id}`))
        .status,
    ).toBe(404);
    expect((await signals(stranger, call.id)).status).toBe(404);
    expect((await action(first, call.id, 'accept')).status).toBe(409);
    expect((await action(second, call.id, 'accept')).status).toBe(200);
    expect((await action(second, call.id, 'accept')).status).toBe(200);
    expect((await action(second, call.id, 'accept', randomUUID())).status).toBe(
      409,
    );
    expect(
      (await signal(first, call.id, { type: 'offer', sdp: 'synthetic offer' }))
        .status,
    ).toBe(200);
    expect(
      (await signal(second, call.id, { type: 'offer', sdp: 'forged offer' }))
        .status,
    ).toBe(409);
    expect((await signals(second, call.id)).body).toEqual({
      items: [
        { sequence: 1, signal: { type: 'offer', sdp: 'synthetic offer' } },
      ],
      next: 1,
    });
    expect((await signals(first, call.id)).body).toEqual({
      items: [],
      next: 1,
    });
    expect((await signals(second, call.id, 1)).body.items).toEqual([]);
    expect(
      (
        await signal(second, call.id, {
          type: 'answer',
          sdp: 'synthetic answer',
        })
      ).status,
    ).toBe(200);
    expect((await signals(first, call.id)).body.items[0].signal.type).toBe(
      'answer',
    );
    const otherSession = request.agent(app.getHttpServer());
    const token = await csrf(otherSession);
    await otherSession
      .post(authEndpoints.login.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email: first.email, password })
      .expect(200);
    expect(
      (
        await otherSession.get(
          url(call.id, `/signals?clientId=${clientId(first)}`),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(first, url(call.id, '/heartbeat'), {
          clientId: clientId(first),
        })
      ).status,
    ).toBe(200);
    const ended = await action(first, call.id, 'end');
    expect(ended.status).toBe(200);
    expect(ended.body.call).toMatchObject({ status: 'ENDED' });
    expect((await action(first, call.id, 'end')).body.call).toMatchObject({
      status: 'ENDED',
    });
    expect(
      (await signal(second, call.id, { type: 'answer', sdp: 'late' })).status,
    ).toBe(409);
    expect(
      await database.prisma.callSeat.count({ where: { callId: call.id } }),
    ).toBe(0);
    expect(
      CallHistoryResponseSchema.parse(
        (await second.client.get(`/api/v1/calls/history/${conversation.id}`))
          .body,
      ).items[0],
    ).toMatchObject({ id: call.id, status: 'ENDED', peer: { id: first.id } });
    expect(Object.keys(ended.body.call).sort()).toEqual(
      [
        'id',
        'conversationId',
        'callerId',
        'peer',
        'kind',
        'status',
        'createdAt',
        'answeredAt',
        'endedAt',
      ].sort(),
    );
  });

  it('reserves both participants atomically during simultaneous outgoing calls', async () => {
    const first = await account(),
      second = await account();
    const conversation = await open(first, second);
    const duplicateId = randomUUID();
    const duplicateBody = {
      id: duplicateId,
      conversationId: conversation.id,
      kind: 'AUDIO',
      clientId: clientId(first),
    };
    const repeated = await Promise.all([
      post(first, callsEndpoints.start.path, duplicateBody),
      post(first, callsEndpoints.start.path, duplicateBody),
    ]);
    expect(repeated.map((result) => result.status)).toEqual([201, 201]);
    await action(first, duplicateId, 'end');
    const results = await Promise.all(
      [first, second].map((who) =>
        post(who, callsEndpoints.start.path, {
          id: randomUUID(),
          conversationId: conversation.id,
          kind: 'AUDIO',
          clientId: clientId(who),
        }),
      ),
    );
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    const winner = results.find((result) => result.status === 201)!.body.call;
    expect(
      await database.prisma.callSeat.count({ where: { callId: winner.id } }),
    ).toBe(2);
    const token = await csrf(second.client);
    const raced = await Promise.all(
      [clientId(second), randomUUID()].map((id) =>
        second.client
          .post(url(winner.id, '/action'))
          .set('Origin', origin)
          .set('X-CSRF-Token', token)
          .send({
            action: winner.callerId === second.id ? 'end' : 'accept',
            clientId: id,
          }),
      ),
    );
    if (winner.callerId !== second.id)
      expect(
        raced.map((result) => result.status).sort((a, b) => a - b),
      ).toEqual([200, 409]);
    await action(first, winner.id, 'end');
    expect(
      await database.prisma.callSeat.count({ where: { callId: winner.id } }),
    ).toBe(0);
  });

  it('records declines, unanswered calls and disconnected calls; logout ends an owned call', async () => {
    const first = await account(),
      second = await account();
    const conversation = await open(first, second);
    const declined = await start(first, conversation.id);
    expect(
      (await action(second, declined.id, 'decline')).body.call.status,
    ).toBe('DECLINED');
    const missed = await start(first, conversation.id);
    await database.prisma.call.update({
      where: { id: missed.id },
      data: { createdAt: new Date(Date.now() - 60000) },
    });
    await calls.sweep();
    expect((await first.client.get(url(missed.id))).body.call.status).toBe(
      'MISSED',
    );
    const disconnected = await start(first, conversation.id);
    await action(second, disconnected.id, 'accept');
    await database.prisma.call.update({
      where: { id: disconnected.id },
      data: { callerSeenAt: new Date(Date.now() - 30000) },
    });
    await calls.sweep();
    expect(
      (await second.client.get(url(disconnected.id))).body.call.status,
    ).toBe('FAILED');
    const logout = await start(first, conversation.id);
    expect((await post(first, authEndpoints.logout.path, {})).status).toBe(200);
    await vi.waitFor(async () =>
      expect((await second.client.get(url(logout.id))).body.call.status).toBe(
        'ENDED',
      ),
    );
    expect(
      (await second.client.get(callsEndpoints.current.path)).body.call,
    ).toBeNull();
  });
});
