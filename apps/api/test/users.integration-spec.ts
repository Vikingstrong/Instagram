import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthSessionResponseSchema,
  AuthUserResponseSchema,
  OwnProfileResponseSchema,
  UserProfileResponseSchema,
  authEndpoints,
  usersEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const password = 'synthetic profile password';
type Agent = ReturnType<typeof request.agent>;
const profilePath = (username: string) =>
  usersEndpoints.profile.path.replace(
    '{username}',
    encodeURIComponent(username),
  );

describe('Users profile HTTP with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .compile();
    app = fixture.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
  });
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
  // Fetch the token before creating the next request on the same agent.
  async function patch(client: Agent, body: unknown, token?: string) {
    const csrfToken = token ?? (await csrf(client));
    return client
      .patch(usersEndpoints.updateOwnProfile.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrfToken)
      .send(body as object);
  }
  async function account(verified = true) {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `P_${suffix.slice(0, 20)}`,
        password,
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    if (verified)
      await database.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    return { client, user };
  }
  async function ok(pending: ReturnType<typeof patch>) {
    const response = await pending;
    expect(response.status).toBe(200);
    return response;
  }
  function errorCode(body: unknown): string {
    return AuthApiErrorResponseSchema.parse(body).error.code;
  }

  it('denies anonymous access and permits registered accounts to every profile route', async () => {
    const anonymous = request.agent(app.getHttpServer());
    const { user } = await account();
    for (const response of [
      await anonymous.get(profilePath(user.username)),
      await anonymous.get(usersEndpoints.ownProfile.path),
      await patch(anonymous, { bio: 'x' }),
    ]) {
      expect(response.status).toBe(401);
      expect(errorCode(response.body)).toBe('AUTHENTICATION_REQUIRED');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const { client } = await account(false);
    for (const response of [
      await client.get(profilePath(user.username)),
      await client.get(usersEndpoints.ownProfile.path),
      await patch(client, { bio: 'x' }),
    ]) {
      expect(response.status).toBe(200);
    }
  });

  it('returns the own editable profile with defaults and only safe fields', async () => {
    const { client, user } = await account();
    const response = await client
      .get(usersEndpoints.ownProfile.path)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(OwnProfileResponseSchema.parse(response.body)).toEqual({
      profile: {
        id: user.id,
        username: user.username,
        displayName: '',
        bio: '',
        avatarUrl: null,
        isPrivate: false,
      },
    });
  });

  it('reads profiles case-insensitively with relationship and accepted-only counters', async () => {
    const owner = await account();
    const viewer = await account();
    const pending = await account();
    const self = UserProfileResponseSchema.parse(
      (
        await owner.client
          .get(profilePath(owner.user.username.toUpperCase()))
          .expect(200)
      ).body,
    ).profile;
    expect(self).toMatchObject({
      id: owner.user.id,
      username: owner.user.username,
      avatarUrl: null,
      relationship: 'self',
      counts: { posts: 0, followers: 0, following: 0 },
    });
    const read = async () =>
      UserProfileResponseSchema.parse(
        (await viewer.client.get(profilePath(owner.user.username)).expect(200))
          .body,
      ).profile;
    expect((await read()).relationship).toBe('none');
    await database.prisma.follow.createMany({
      data: [
        {
          followerId: viewer.user.id,
          followeeId: owner.user.id,
          status: 'PENDING',
        },
        {
          followerId: owner.user.id,
          followeeId: pending.user.id,
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      ],
    });
    expect(await read()).toMatchObject({
      relationship: 'requested',
      counts: { followers: 0, following: 1 },
    });
    await database.prisma.follow.update({
      where: {
        followerId_followeeId: {
          followerId: viewer.user.id,
          followeeId: owner.user.id,
        },
      },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    expect(await read()).toMatchObject({
      relationship: 'following',
      counts: { followers: 1, following: 1 },
    });
  });

  it('hides unknown accounts and rejects malformed usernames', async () => {
    const { client } = await account();
    const unverified = await account(false);
    await client.get(profilePath(unverified.user.username)).expect(200);
    for (const name of ['no_such_user_x9']) {
      const response = await client.get(profilePath(name));
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('USER_NOT_FOUND');
    }
    const malformed = await client.get(profilePath('bad name!'));
    expect(malformed.status).toBe(400);
    expect(errorCode(malformed.body)).toBe('INVALID_REQUEST');
  });

  it('returns the private profile summary with counters to other users', async () => {
    const owner = await account();
    const viewer = await account();
    await ok(
      patch(owner.client, {
        isPrivate: true,
        displayName: 'Closed',
        bio: 'Hidden posts',
      }),
    );
    const profile = UserProfileResponseSchema.parse(
      (await viewer.client.get(profilePath(owner.user.username)).expect(200))
        .body,
    ).profile;
    expect(profile).toMatchObject({
      isPrivate: true,
      displayName: 'Closed',
      bio: 'Hidden posts',
      relationship: 'none',
    });
  });

  it('requires Origin and CSRF and validates every profile field', async () => {
    const { client } = await account();
    const token = await csrf(client);
    const forged = await client
      .patch(usersEndpoints.updateOwnProfile.path)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', token)
      .send({ bio: 'x' });
    expect(forged.status).toBe(403);
    expect(errorCode(forged.body)).toBe('REQUEST_FORBIDDEN');
    expect((await patch(client, { bio: 'x' }, 'bad')).status).toBe(403);
    for (const body of [
      {},
      { bio: 'b'.repeat(151) },
      { displayName: 'd'.repeat(31) },
      { displayName: 'line\nbreak' },
      { username: 'no spaces' },
      { isPrivate: 'yes' },
      { id: randomUUID() },
      { emailVerified: true },
    ]) {
      const response = await patch(client, body);
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('INVALID_REQUEST');
    }
    // Limits count code points like the VARCHAR columns.
    const emoji = '🙂'.repeat(30);
    const accepted = OwnProfileResponseSchema.parse(
      (
        await ok(
          patch(client, {
            displayName: emoji,
            bio: `${'🔒'.repeat(149)}\n`,
          }),
        )
      ).body,
    ).profile;
    expect(accepted.displayName).toBe(emoji);
  });

  it('persists edits, renames uniquely and keeps the session on the new username', async () => {
    const first = await account();
    const second = await account();
    const renamed = `n_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const updated = OwnProfileResponseSchema.parse(
      (
        await ok(
          patch(first.client, {
            username: renamed,
            displayName: 'Новое имя',
            bio: 'Био\nв две строки',
          }),
        )
      ).body,
    ).profile;
    expect(updated).toEqual({
      id: first.user.id,
      username: renamed,
      displayName: 'Новое имя',
      bio: 'Био\nв две строки',
      avatarUrl: null,
      isPrivate: false,
    });
    expect(
      OwnProfileResponseSchema.parse(
        (await first.client.get(usersEndpoints.ownProfile.path).expect(200))
          .body,
      ).profile,
    ).toEqual(updated);
    expect(
      AuthSessionResponseSchema.parse(
        (await first.client.get(authEndpoints.session.path).expect(200)).body,
      ).user?.username,
    ).toBe(renamed);
    expect(
      (await second.client.get(profilePath(first.user.username))).status,
    ).toBe(404);
    await second.client.get(profilePath(renamed)).expect(200);
    const taken = await patch(second.client, {
      username: renamed.toUpperCase(),
    });
    expect(taken.status).toBe(409);
    expect(errorCode(taken.body)).toBe('USERNAME_TAKEN');
    // Changing only the letter case of one's own name is allowed.
    await ok(patch(first.client, { username: renamed.toUpperCase() }));
  });

  it('approves pending requests when going public and keeps followers when going private', async () => {
    const owner = await account();
    const follower = await account();
    const requester = await account();
    await ok(patch(owner.client, { isPrivate: true }));
    await database.prisma.follow.createMany({
      data: [
        {
          followerId: follower.user.id,
          followeeId: owner.user.id,
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
        {
          followerId: requester.user.id,
          followeeId: owner.user.id,
          status: 'PENDING',
        },
      ],
    });
    // Editing other fields of a private profile changes no relationship.
    await ok(patch(owner.client, { bio: 'still private' }));
    expect(
      await database.prisma.follow.count({
        where: { followeeId: owner.user.id, status: 'PENDING' },
      }),
    ).toBe(1);
    await ok(patch(owner.client, { isPrivate: false }));
    const rows = await database.prisma.follow.findMany({
      where: { followeeId: owner.user.id },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('ACCEPTED');
      expect(row.acceptedAt).not.toBeNull();
    }
    await ok(patch(owner.client, { isPrivate: true }));
    expect(
      await database.prisma.follow.count({
        where: { followeeId: owner.user.id, status: 'ACCEPTED' },
      }),
    ).toBe(2);
  });

  it('enforces follow invariants in the database', async () => {
    const { user } = await account();
    const other = await account();
    await expect(
      database.prisma.follow.create({
        data: { followerId: user.id, followeeId: user.id, status: 'PENDING' },
      }),
    ).rejects.toThrow();
    for (const data of [
      { status: 'ACCEPTED' as const, acceptedAt: null },
      { status: 'PENDING' as const, acceptedAt: new Date() },
    ])
      await expect(
        database.prisma.follow.create({
          data: { followerId: user.id, followeeId: other.user.id, ...data },
        }),
      ).rejects.toThrow();
    await database.prisma.follow.create({
      data: {
        followerId: user.id,
        followeeId: other.user.id,
        status: 'PENDING',
      },
    });
    await expect(
      database.prisma.follow.create({
        data: {
          followerId: user.id,
          followeeId: other.user.id,
          status: 'PENDING',
        },
      }),
    ).rejects.toThrow();
  });
});
