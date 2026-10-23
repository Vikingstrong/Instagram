import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  FollowRequestListResponseSchema,
  FollowResponseSchema,
  SuggestionsResponseSchema,
  UserListResponseSchema,
  UserProfileResponseSchema,
  authEndpoints,
  socialEndpoints,
  usersEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; username: string };
const path = (template: string, id: string) => template.replace('{id}', id);

describe('Social graph, suggestions and search with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({ factory: () => new DatabaseService(testUrl) })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      // Rate limits have their own tests; this suite makes many mutations.
      .overrideProvider(AuthRateLimiter)
      .useValue({ consume: () => undefined })
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
  async function send(
    client: Agent,
    method: 'post' | 'delete',
    url: string,
    body: object = {},
  ) {
    const token = await csrf(client);
    return client[method](url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  async function account(
    options: {
      verified?: boolean;
      isPrivate?: boolean;
      displayName?: string;
    } = {},
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
        username: `s_${suffix.slice(0, 20)}`,
        password: 'synthetic social password',
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    await database.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: options.verified === false ? null : new Date(),
        isPrivate: options.isPrivate ?? false,
        displayName: options.displayName ?? '',
        displayNameKey: (options.displayName ?? '').toLowerCase(),
      },
    });
    return { client, id: user.id, username: user.username };
  }
  const follow = (from: Account, to: string) =>
    send(from.client, 'post', path(socialEndpoints.follow.path, to));
  const unfollow = (from: Account, to: string) =>
    send(from.client, 'delete', path(socialEndpoints.unfollow.path, to));
  const accept = (owner: Account, requester: string) =>
    send(
      owner.client,
      'post',
      path(socialEndpoints.acceptRequest.path, requester),
    );
  const decline = (owner: Account, requester: string) =>
    send(
      owner.client,
      'post',
      path(socialEndpoints.declineRequest.path, requester),
    );
  const relationship = (body: unknown) =>
    FollowResponseSchema.parse(body).relationship;
  function errorCode(body: unknown): string {
    return AuthApiErrorResponseSchema.parse(body).error.code;
  }
  async function profile(viewer: Account, target: Account) {
    const response = await viewer.client
      .get(usersEndpoints.profile.path.replace('{username}', target.username))
      .expect(200);
    return UserProfileResponseSchema.parse(response.body).profile;
  }
  async function list(viewer: Account, url: string) {
    const response = await viewer.client.get(url);
    return {
      status: response.status,
      body: response.body as unknown,
    };
  }

  it('requires a verified session for every social route', async () => {
    const target = await account();
    const anonymous = request.agent(app.getHttpServer());
    const unverified = await account({ verified: false });
    const reads = [
      path(socialEndpoints.followers.path, target.id),
      socialEndpoints.followRequests.path,
      socialEndpoints.suggestions.path,
      `${socialEndpoints.search.path}?q=abc`,
    ];
    for (const url of reads) {
      expect((await anonymous.get(url)).status).toBe(401);
      const denied = await unverified.client.get(url);
      expect(denied.status).toBe(403);
      expect(errorCode(denied.body)).toBe('EMAIL_VERIFICATION_REQUIRED');
    }
    expect(
      (
        await send(
          anonymous,
          'post',
          path(socialEndpoints.follow.path, target.id),
        )
      ).status,
    ).toBe(401);
    expect((await follow(unverified, target.id)).status).toBe(403);
  });

  it('follows a public profile at once, idempotently, and updates counters', async () => {
    const viewer = await account();
    const target = await account();
    for (let i = 0; i < 2; i++) {
      const response = await follow(viewer, target.id);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(relationship(response.body)).toBe('following');
    }
    expect(await profile(viewer, target)).toMatchObject({
      relationship: 'following',
      counts: { followers: 1, following: 0 },
    });
    expect((await profile(target, viewer)).counts.following).toBe(1);
    const left = await unfollow(viewer, target.id);
    expect(relationship(left.body)).toBe('none');
    expect(relationship((await unfollow(viewer, target.id)).body)).toBe('none');
    expect(await profile(viewer, target)).toMatchObject({
      relationship: 'none',
      counts: { followers: 0 },
    });
  });

  it('rejects self, unknown, unverified, malformed and forged follow requests', async () => {
    const viewer = await account();
    const unverified = await account({ verified: false });
    const self = await follow(viewer, viewer.id);
    expect(self.status).toBe(400);
    expect(errorCode(self.body)).toBe('CANNOT_FOLLOW_SELF');
    for (const id of [randomUUID(), unverified.id]) {
      const missing = await follow(viewer, id);
      expect(missing.status).toBe(404);
      expect(errorCode(missing.body)).toBe('USER_NOT_FOUND');
    }
    expect((await follow(viewer, 'not-a-uuid')).status).toBe(400);
    const target = await account();
    const extra = await send(
      viewer.client,
      'post',
      path(socialEndpoints.follow.path, target.id),
      { status: 'ACCEPTED' },
    );
    expect(extra.status).toBe(400);
    const token = await csrf(viewer.client);
    const forged = await viewer.client
      .post(path(socialEndpoints.follow.path, target.id))
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', token)
      .send({});
    expect(forged.status).toBe(403);
    expect(errorCode(forged.body)).toBe('REQUEST_FORBIDDEN');
    expect(
      await database.prisma.follow.count({ where: { followerId: viewer.id } }),
    ).toBe(0);
  });

  it('turns a private follow into a request that the owner accepts or declines', async () => {
    const owner = await account({ isPrivate: true });
    const first = await account();
    const second = await account();
    expect(relationship((await follow(first, owner.id)).body)).toBe(
      'requested',
    );
    expect(relationship((await follow(first, owner.id)).body)).toBe(
      'requested',
    );
    expect(relationship((await follow(second, owner.id)).body)).toBe(
      'requested',
    );
    expect(await profile(first, owner)).toMatchObject({
      relationship: 'requested',
      counts: { followers: 0 },
    });
    const pending = FollowRequestListResponseSchema.parse(
      (await owner.client.get(socialEndpoints.followRequests.path).expect(200))
        .body,
    );
    expect(pending.items.map((item) => item.user.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(pending.nextCursor).toBeNull();
    // Requests are visible only to the profile owner.
    expect(
      FollowRequestListResponseSchema.parse(
        (
          await first.client
            .get(socialEndpoints.followRequests.path)
            .expect(200)
        ).body,
      ).items,
    ).toEqual([]);

    expect((await accept(owner, first.id)).body).toEqual({
      status: 'accepted',
    });
    expect(await profile(first, owner)).toMatchObject({
      relationship: 'following',
      counts: { followers: 1 },
    });
    const again = await accept(owner, first.id);
    expect(again.status).toBe(404);
    expect(errorCode(again.body)).toBe('FOLLOW_REQUEST_NOT_FOUND');

    expect((await decline(owner, second.id)).body).toEqual({
      status: 'declined',
    });
    expect((await profile(second, owner)).relationship).toBe('none');
    expect((await decline(owner, second.id)).status).toBe(404);
    // A declined user may ask again; the requester can cancel it.
    expect(relationship((await follow(second, owner.id)).body)).toBe(
      'requested',
    );
    expect(relationship((await unfollow(second, owner.id)).body)).toBe('none');
    expect((await accept(owner, second.id)).status).toBe(404);
    // Another user cannot act on the owner's requests.
    await follow(second, owner.id);
    expect((await accept(first, second.id)).status).toBe(404);
    expect((await profile(second, owner)).relationship).toBe('requested');
  });

  it('keeps one row under concurrent follows and resolves accept/decline races once', async () => {
    const owner = await account({ isPrivate: true });
    const requester = await account();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => follow(requester, owner.id)),
    );
    for (const response of results) {
      expect(response.status).toBe(200);
      expect(relationship(response.body)).toBe('requested');
    }
    expect(
      await database.prisma.follow.count({ where: { followeeId: owner.id } }),
    ).toBe(1);
    const decisions = await Promise.all([
      accept(owner, requester.id),
      decline(owner, requester.id),
      accept(owner, requester.id),
    ]);
    expect(
      decisions.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(
      decisions.filter((response) => response.status === 404),
    ).toHaveLength(2);
  });

  it('never leaves a request pending when the profile turns public concurrently', async () => {
    const owner = await account({ isPrivate: true });
    const requesters = await Promise.all(
      Array.from({ length: 4 }, () => account()),
    );
    const token = await csrf(owner.client);
    await Promise.all([
      ...requesters.map((requester) => follow(requester, owner.id)),
      owner.client
        .patch(usersEndpoints.updateOwnProfile.path)
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .send({ isPrivate: false }),
    ]);
    expect(
      await database.prisma.follow.count({
        where: { followeeId: owner.id, status: 'PENDING' },
      }),
    ).toBe(0);
    expect(
      await database.prisma.follow.count({
        where: { followeeId: owner.id, status: 'ACCEPTED' },
      }),
    ).toBe(4);
  });

  it('removes a follower idempotently and ends private access', async () => {
    const owner = await account({ isPrivate: true });
    const follower = await account();
    await follow(follower, owner.id);
    await accept(owner, follower.id);
    const followersUrl = path(socialEndpoints.followers.path, owner.id);
    expect((await list(follower, followersUrl)).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      const removed = await send(
        owner.client,
        'delete',
        path(socialEndpoints.removeFollower.path, follower.id),
      );
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ status: 'removed' });
    }
    expect((await profile(follower, owner)).relationship).toBe('none');
    const denied = await list(follower, followersUrl);
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('PROFILE_PRIVATE');
  });

  it('protects lists of private profiles and paginates them newest first', async () => {
    const owner = await account({ isPrivate: true });
    const stranger = await account();
    const followers: Account[] = [];
    for (let i = 0; i < 5; i++) {
      const follower = await account();
      await follow(follower, owner.id);
      await accept(owner, follower.id);
      followers.push(follower);
    }
    const followersUrl = path(socialEndpoints.followers.path, owner.id);
    for (const url of [
      followersUrl,
      path(socialEndpoints.following.path, owner.id),
    ]) {
      const denied = await list(stranger, url);
      expect(denied.status).toBe(403);
      expect(errorCode(denied.body)).toBe('PROFILE_PRIVATE');
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `${followersUrl}?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = UserListResponseSchema.parse(
        (await followers[0]!.client.get(url).expect(200)).body,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(followers.map((follower) => follower.id).reverse());
    const own = UserListResponseSchema.parse(
      (await owner.client.get(followersUrl).expect(200)).body,
    );
    expect(own.items).toHaveLength(5);
    expect(own.items[0]).toEqual({
      id: followers[4]!.id,
      username: followers[4]!.username,
      displayName: '',
      avatarUrl: null,
      isPrivate: false,
    });
    const following = UserListResponseSchema.parse(
      (
        await stranger.client
          .get(path(socialEndpoints.following.path, followers[0]!.id))
          .expect(200)
      ).body,
    );
    expect(following.items.map((item) => item.id)).toEqual([owner.id]);
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=abc',
      'cursor=@@',
      'cursor=bm9wZQ',
      'extra=1',
    ]) {
      expect((await list(owner, `${followersUrl}?${query}`)).status).toBe(400);
    }
    expect(
      (await list(owner, path(socialEndpoints.followers.path, randomUUID())))
        .status,
    ).toBe(404);
  });

  it('suggests random verified accounts the viewer neither follows nor requested', async () => {
    const viewer = await account();
    const followed = await account();
    const requested = await account({ isPrivate: true });
    const unverified = await account({ verified: false });
    await follow(viewer, followed.id);
    await follow(viewer, requested.id);
    const excluded = new Set([
      viewer.id,
      followed.id,
      requested.id,
      unverified.id,
    ]);
    for (let i = 0; i < 3; i++) {
      const response = await viewer.client
        .get(`${socialEndpoints.suggestions.path}?limit=20`)
        .expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const { items } = SuggestionsResponseSchema.parse(response.body);
      expect(items.length).toBeLessThanOrEqual(20);
      for (const item of items) expect(excluded.has(item.id)).toBe(false);
    }
    const fresh = await account();
    const defaults = SuggestionsResponseSchema.parse(
      (await fresh.client.get(socialEndpoints.suggestions.path).expect(200))
        .body,
    ).items;
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.length).toBeLessThanOrEqual(5);
    for (const query of ['limit=0', 'limit=21', 'cursor=abc']) {
      expect(
        (await list(viewer, `${socialEndpoints.suggestions.path}?${query}`))
          .status,
      ).toBe(400);
    }
  });

  it('searches usernames and display names case-insensitively with pages', async () => {
    const token = randomUUID().replaceAll('-', '').slice(0, 12);
    const viewer = await account();
    const named = await Promise.all(
      ['Alpha', 'Beta', 'Gamma'].map((name) =>
        account({ displayName: `${name} Zq${token}` }),
      ),
    );
    await account({ verified: false, displayName: `Hidden Zq${token}` });
    // Unicode case folding must not depend on the database collation.
    const cyrillic = await account({ displayName: `Ёжик Ж${token}` });
    const search = (query: string) =>
      viewer.client.get(
        `${socialEndpoints.search.path}?q=${encodeURIComponent(query)}`,
      );
    const all = UserListResponseSchema.parse(
      (await search(`  zQ${token.toUpperCase()} `).expect(200)).body,
    );
    expect(all.items.map((item) => item.id).sort()).toEqual(
      named.map((user) => user.id).sort(),
    );
    expect(all.items[0]).not.toHaveProperty('bio');
    const byName = UserListResponseSchema.parse(
      (await search(named[1]!.username.toUpperCase()).expect(200)).body,
    );
    expect(byName.items.map((item) => item.id)).toEqual([named[1]!.id]);
    for (const query of [`ёЖИК ж${token}`, `ЁЖИК`]) {
      expect(
        UserListResponseSchema.parse(
          (await search(query).expect(200)).body,
        ).items.map((item) => item.id),
      ).toContain(cyrillic.id);
    }
    // LIKE wildcards are literal characters.
    for (const query of [`%${token}`, `_q${token}`, `\\${token}`]) {
      expect(
        UserListResponseSchema.parse((await search(query).expect(200)).body)
          .items,
      ).toEqual([]);
    }
    const first = UserListResponseSchema.parse(
      (
        await viewer.client
          .get(`${socialEndpoints.search.path}?q=Zq${token}&limit=2`)
          .expect(200)
      ).body,
    );
    expect(first.items).toHaveLength(2);
    const second = UserListResponseSchema.parse(
      (
        await viewer.client
          .get(
            `${socialEndpoints.search.path}?q=Zq${token}&limit=2&cursor=${first.nextCursor}`,
          )
          .expect(200)
      ).body,
    );
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.items, ...second.items].map((item) => item.username),
    ).toEqual(
      named
        .map((user) => user.username)
        .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)),
    );
    for (const query of ['', '   ', 'x'.repeat(161)]) {
      expect((await search(query)).status).toBe(400);
    }
    expect((await viewer.client.get(socialEndpoints.search.path)).status).toBe(
      400,
    );
    expect((await search('x'.repeat(160))).status).toBe(200);
  });
});
