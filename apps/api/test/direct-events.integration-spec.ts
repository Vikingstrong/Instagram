import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  ConversationResponseSchema,
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
import {
  DIRECT_EVENTS_CONFIG,
  DirectEvents,
  defaultDirectEventsConfig,
} from '../src/direct/direct-events.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const eventsPath = '/api/v1/direct/events';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; cookie: string };
type Frame = { event: string; data: string };

// Reads an SSE response into frames ("message" events and comments).
function connect(port: number, cookie?: string) {
  const frames: Frame[] = [];
  let buffer = '';
  let response: IncomingMessage | undefined;
  const ended = new Promise<void>((resolve) => {
    const req = get(
      {
        host: '127.0.0.1',
        port,
        path: eventsPath,
        headers: {
          Accept: 'text/event-stream',
          ...(cookie && { Cookie: cookie }),
        },
      },
      (res) => {
        response = res;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const frame: Frame = { event: 'message', data: '' };
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) frame.event = 'comment';
              else if (line.startsWith('event: ')) frame.event = line.slice(7);
              else if (line.startsWith('data: ')) frame.data = line.slice(6);
            }
            if (block.trim() !== 'retry: 3000') frames.push(frame);
          }
        });
        res.on('end', resolve);
        res.on('close', resolve);
      },
    );
    req.on('error', () => resolve());
  });
  const until = async (check: () => boolean, ms = 5_000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('Timed out waiting for SSE');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return {
    frames,
    ended,
    until,
    status: () => response?.statusCode,
    headers: () => response?.headers ?? {},
    notices: () => frames.filter((frame) => frame.event === 'message'),
    close: () => response?.destroy(),
  };
}

describe('Direct realtime notices over SSE with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let events: DirectEvents;
  let port: number;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(AuthRateLimiter)
      .useValue({ consume: () => undefined })
      .overrideProvider(DIRECT_EVENTS_CONFIG)
      .useValue({ ...defaultDirectEventsConfig, heartbeatMs: 150 })
      .compile();
    app = fixture.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    port = ((app.getHttpServer() as unknown as Server).address() as AddressInfo)
      .port;
    database = app.get(DatabaseService);
    events = app.get(DirectEvents);
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
  async function account(verified = true): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `s_${suffix.slice(0, 20)}`,
        password: 'synthetic stream password',
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    if (verified)
      await database.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    const cookie = response.headers['set-cookie'] as unknown as string[];
    return {
      client,
      id: user.id,
      cookie: cookie.map((value) => value.split(';')[0]).join('; '),
    };
  }
  async function post(who: Account, url: string, body: object) {
    const token = await csrf(who.client);
    return who.client
      .post(url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  async function conversation(a: Account, b: Account) {
    return ConversationResponseSchema.parse(
      (await post(a, directEndpoints.open.path, { userId: b.id })).body,
    ).conversation.id;
  }
  const send = (who: Account, id: string, text: string, key = randomUUID()) =>
    post(who, directEndpoints.send.path.replace('{id}', id), {
      clientMessageId: key,
      text,
    });

  it('opens only for a session and announces readiness first', async () => {
    const anonymous = connect(port);
    await anonymous.ended;
    expect(anonymous.status()).toBe(401);
    const unverified = connect(port, (await account(false)).cookie);
    await unverified.until(() => unverified.frames.length > 0);
    expect(unverified.status()).toBe(200);
    unverified.close();

    const alice = await account();
    const stream = connect(port, alice.cookie);
    await stream.until(() => stream.frames.length > 0);
    expect(stream.status()).toBe(200);
    expect(stream.headers()['content-type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(stream.headers()['cache-control']).toContain('no-transform');
    expect(stream.frames[0]).toEqual({ event: 'ready', data: '{}' });
    // Heartbeat comments keep the connection alive.
    await stream.until(() =>
      stream.frames.some((frame) => frame.event === 'comment'),
    );
    stream.close();
    await stream.ended;
    await stream.until(() => events.count(alice.id) === 0);
  });

  it('notifies both participants after commit, never outsiders, and not for a replay', async () => {
    const alice = await account();
    const bob = await account();
    const eve = await account();
    const id = await conversation(alice, bob);
    const streams = [alice, bob, eve].map((who) => connect(port, who.cookie));
    for (const stream of streams)
      await stream.until(() => stream.frames[0]?.event === 'ready');

    const key = randomUUID();
    const sent = DirectMessageResponseSchema.parse(
      (await send(alice, id, 'секретный текст', key)).body,
    ).message;
    const [toAlice, toBob, toEve] = streams;
    await toBob!.until(() => toBob!.notices().length === 1);
    await toAlice!.until(() => toAlice!.notices().length === 1);
    for (const stream of [toAlice!, toBob!]) {
      expect(JSON.parse(stream.notices()[0]!.data)).toEqual({
        conversationId: id,
        messageId: sent.id,
      });
      // Only ids travel over the stream; the text is read over REST.
      expect(JSON.stringify(stream.frames)).not.toContain('секретный');
    }

    await send(alice, id, 'секретный текст', key);
    await send(bob, id, 'ответ');
    await toAlice!.until(() => toAlice!.notices().length === 2);
    expect(toEve!.notices()).toEqual([]);
    for (const stream of streams) stream.close();
  });

  it('ends the stream on logout, password-session revocation and in another tab', async () => {
    const alice = await account();
    const first = connect(port, alice.cookie);
    await first.until(() => first.frames[0]?.event === 'ready');
    const token = await csrf(alice.client);
    await alice.client
      .post(authEndpoints.logout.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({})
      .expect(200);
    await first.ended;
    expect(events.count(alice.id)).toBe(0);
    const after = connect(port, alice.cookie);
    await after.ended;
    expect(after.status()).toBe(401);

    // Any other revocation path is caught by the heartbeat session check.
    const bob = await account();
    const stream = connect(port, bob.cookie);
    await stream.until(() => stream.frames[0]?.event === 'ready');
    await database.prisma.authSession.updateMany({
      where: { userId: bob.id },
      data: { revokedAt: new Date() },
    });
    await stream.ended;
    expect(events.count(bob.id)).toBe(0);
  });
});
