import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  AvatarResponseSchema,
  PostListResponseSchema,
  PostResponseSchema,
  UserProfileResponseSchema,
  authEndpoints,
  postsEndpoints,
  socialEndpoints,
  usersEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { MediaService } from '../src/media/media.service.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; username: string };
const path = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key]!);

// Synthetic images: a camera-sized JPEG carrying EXIF that must be stripped.
async function jpeg(width = 1600, height = 1200) {
  return sharp({
    create: { width, height, channels: 3, background: '#3a6ea5' },
  })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner', Artist: 'gps-person' } })
    .toBuffer();
}
const png = () =>
  sharp({
    create: { width: 300, height: 500, channels: 4, background: '#fff0' },
  })
    .png()
    .toBuffer();

describe('Posts, avatars and private media with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let root: string;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'instagram-media-'));
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
    database = app.get(DatabaseService);
  }, 30_000);
  afterAll(async () => {
    try {
      await database.prisma.post.deleteMany({
        where: { authorId: { in: ownedIds } },
      });
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
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `m_${suffix.slice(0, 20)}`,
        password: 'synthetic media password',
      })
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
    return { client, id: user.id, username: user.username };
  }
  async function upload(
    who: Account,
    url: string,
    method: 'post' | 'put',
    file?: { data: Buffer; name?: string; type?: string },
    fields: Record<string, string> = {},
  ) {
    const token = await csrf(who.client);
    let req = who.client[method](url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token);
    for (const [key, value] of Object.entries(fields))
      req = req.field(key, value);
    if (file)
      req = req.attach('image', file.data, {
        filename: file.name ?? 'photo.jpg',
        contentType: file.type ?? 'image/jpeg',
      });
    // Without a file the request must still be multipart.
    else if (!('caption' in fields)) req = req.field('caption', '');
    return req;
  }
  const createPost = async (who: Account, caption = 'Первый пост') =>
    PostResponseSchema.parse(
      (
        await upload(
          who,
          postsEndpoints.create.path,
          'post',
          { data: await jpeg() },
          { caption },
        )
      ).body,
    ).post;
  async function send(who: Account, method: 'post' | 'delete', url: string) {
    const token = await csrf(who.client);
    return who.client[method](url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({});
  }
  const errorCode = (body: unknown) =>
    AuthApiErrorResponseSchema.parse(body).error.code;
  const mediaId = (url: string) => url.split('/')[4]!;
  const files = async (id: string) => {
    try {
      return (await readdir(join(root, id))).sort();
    } catch {
      return [];
    }
  };

  it('requires a session, Origin/CSRF and a multipart body', async () => {
    const anonymous = request.agent(app.getHttpServer());
    expect(
      (await anonymous.get(path(postsEndpoints.get.path, { id: randomUUID() })))
        .status,
    ).toBe(401);
    expect(
      (
        await anonymous.get(
          path(postsEndpoints.media.path, {
            id: randomUUID(),
            variant: 'full',
          }),
        )
      ).status,
    ).toBe(401);
    const unverified = await account({ verified: false });
    const denied = await upload(
      unverified,
      postsEndpoints.create.path,
      'post',
      { data: await jpeg() },
    );
    expect(denied.status).toBe(201);

    const author = await account();
    const forgedToken = await csrf(author.client);
    const forged = await author.client
      .post(postsEndpoints.create.path)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', forgedToken)
      .attach('image', await jpeg(), 'photo.jpg');
    expect(forged.status).toBe(403);
    expect(errorCode(forged.body)).toBe('REQUEST_FORBIDDEN');
    const token = await csrf(author.client);
    const json = await author.client
      .post(postsEndpoints.create.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ caption: 'no file' });
    expect(json.status).toBe(400);
    expect(
      await database.prisma.media.count({ where: { ownerId: author.id } }),
    ).toBe(0);
  });

  it('publishes one re-encoded image without metadata and serves it privately', async () => {
    const author = await account();
    const response = await upload(
      author,
      postsEndpoints.create.path,
      'post',
      { data: await jpeg(), name: 'IMG_0001.JPG' },
      { caption: 'Закат\nна море' },
    );
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const post = PostResponseSchema.parse(response.body).post;
    expect(post).toMatchObject({
      caption: 'Закат\nна море',
      author: { id: author.id, username: author.username },
      image: { width: 1080, height: 810 },
    });
    const id = mediaId(post.image.url);
    expect(await files(id)).toEqual(['full.webp', 'thumb.webp']);

    const full = await author.client
      .get(post.image.url)
      .buffer(true)
      .expect(200);
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['cache-control']).toBe('private, no-store');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    const fullMeta = await sharp(full.body as Buffer).metadata();
    expect(fullMeta).toMatchObject({
      format: 'webp',
      width: 1080,
      height: 810,
    });
    expect(fullMeta.exif).toBeUndefined();
    const thumb = await author.client
      .get(post.image.thumbnailUrl)
      .buffer(true)
      .expect(200);
    expect(await sharp(thumb.body as Buffer).metadata()).toMatchObject({
      width: 480,
      height: 480,
    });
    expect(
      (
        await author.client.get(
          path(postsEndpoints.media.path, { id, variant: 'raw' }),
        )
      ).status,
    ).toBe(404);

    expect(
      PostResponseSchema.parse(
        (
          await author.client
            .get(path(postsEndpoints.get.path, { id: post.id }))
            .expect(200)
        ).body,
      ).post,
    ).toEqual(post);
    const profile = UserProfileResponseSchema.parse(
      (
        await author.client
          .get(path(usersEndpoints.profile.path, { username: author.username }))
          .expect(200)
      ).body,
    ).profile;
    expect(profile.counts.posts).toBe(1);
    // PNG with transparency is accepted too; caption is optional.
    const second = await upload(author, postsEndpoints.create.path, 'post', {
      data: await png(),
      name: 'shot.png',
      type: 'image/png',
    });
    expect(second.status).toBe(201);
    expect(PostResponseSchema.parse(second.body).post).toMatchObject({
      caption: '',
      image: { width: 300, height: 500 },
    });
  });

  it('rejects missing, fake, unsupported, oversized and pixel-bomb files without leaving data', async () => {
    const author = await account();
    const cases: [Awaited<ReturnType<typeof upload>>, number, string][] = [
      [
        await upload(author, postsEndpoints.create.path, 'post', undefined, {
          caption: 'нет фото',
        }),
        400,
        'INVALID_IMAGE',
      ],
      [
        await upload(author, postsEndpoints.create.path, 'post', {
          data: Buffer.from('not an image at all'),
          name: 'x.jpg',
        }),
        400,
        'INVALID_IMAGE',
      ],
      [
        await upload(author, postsEndpoints.create.path, 'post', {
          data: await sharp({
            create: { width: 10, height: 10, channels: 3, background: '#000' },
          })
            .gif()
            .toBuffer(),
          name: 'x.gif',
          type: 'image/gif',
        }),
        400,
        'INVALID_IMAGE',
      ],
      [
        await upload(author, postsEndpoints.create.path, 'post', {
          data: randomBytes(10 * 1024 * 1024 + 1),
          name: 'big.jpg',
        }),
        413,
        'IMAGE_TOO_LARGE',
      ],
      [
        await upload(author, postsEndpoints.create.path, 'post', {
          data: await sharp({
            create: {
              width: 8000,
              height: 6000,
              channels: 3,
              background: '#000',
            },
          })
            .png()
            .toBuffer(),
          name: 'bomb.png',
          type: 'image/png',
        }),
        400,
        'INVALID_IMAGE',
      ],
      [
        await upload(
          author,
          postsEndpoints.create.path,
          'post',
          { data: await jpeg() },
          { caption: 'x'.repeat(2201) },
        ),
        400,
        'INVALID_REQUEST',
      ],
      [
        await upload(
          author,
          postsEndpoints.create.path,
          'post',
          { data: await jpeg() },
          { authorId: randomUUID() },
        ),
        400,
        'INVALID_REQUEST',
      ],
    ];
    for (const [index, [response, status, code]] of cases.entries()) {
      expect([index, response.status]).toEqual([index, status]);
      expect([index, errorCode(response.body)]).toEqual([index, code]);
    }
    expect(
      await database.prisma.post.count({ where: { authorId: author.id } }),
    ).toBe(0);
    expect(
      await database.prisma.media.count({
        where: { ownerId: author.id, state: { not: 'DELETED' } },
      }),
    ).toBe(0);
  }, 60_000);

  it('creates no post and removes the files when the database step fails', async () => {
    const author = await account();
    const media = app.get(MediaService);
    const before = (await readdir(root)).sort();
    const spy = vi
      .spyOn(media, 'activate')
      .mockRejectedValueOnce(new Error('simulated failure'));
    const response = await upload(author, postsEndpoints.create.path, 'post', {
      data: await jpeg(),
    });
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(errorCode(response.body)).toBe('INTERNAL_ERROR');
    expect(
      await database.prisma.post.count({ where: { authorId: author.id } }),
    ).toBe(0);
    expect(
      await database.prisma.media.count({ where: { ownerId: author.id } }),
    ).toBe(0);
    // The written files of the failed upload were removed again.
    expect((await readdir(root)).sort()).toEqual(before);
  });

  it('applies private-profile rules to posts, grids and image files, including revocation', async () => {
    const owner = await account({ isPrivate: true });
    const stranger = await account();
    const follower = await account();
    const post = await createPost(owner);
    const postUrl = path(postsEndpoints.get.path, { id: post.id });
    const gridUrl = path(postsEndpoints.byUser.path, { id: owner.id });
    const expectHidden = async (who: Account) => {
      const read = await who.client.get(postUrl);
      expect(read.status).toBe(404);
      expect(errorCode(read.body)).toBe('POST_NOT_FOUND');
      for (const url of [post.image.url, post.image.thumbnailUrl]) {
        const file = await who.client.get(url);
        expect(file.status).toBe(404);
        expect(errorCode(file.body)).toBe('MEDIA_NOT_FOUND');
      }
      const grid = await who.client.get(gridUrl);
      expect(grid.status).toBe(403);
      expect(errorCode(grid.body)).toBe('PROFILE_PRIVATE');
    };
    await expectHidden(stranger);
    // A pending request grants nothing.
    await send(
      follower,
      'post',
      path(socialEndpoints.follow.path, { id: owner.id }),
    );
    await expectHidden(follower);
    await send(
      owner,
      'post',
      path(socialEndpoints.acceptRequest.path, { id: follower.id }),
    );
    await follower.client.get(postUrl).expect(200);
    await follower.client.get(post.image.url).expect(200);
    expect(
      PostListResponseSchema.parse(
        (await follower.client.get(gridUrl).expect(200)).body,
      ).items.map((item) => item.id),
    ).toEqual([post.id]);
    // Removing the follower revokes access for every new request.
    await send(
      owner,
      'delete',
      path(socialEndpoints.removeFollower.path, { id: follower.id }),
    );
    await expectHidden(follower);
    // Profile counters stay public (FR-02).
    expect(
      UserProfileResponseSchema.parse(
        (
          await stranger.client
            .get(
              path(usersEndpoints.profile.path, { username: owner.username }),
            )
            .expect(200)
        ).body,
      ).profile.counts.posts,
    ).toBe(1);
  });

  it('pages a profile grid newest first', async () => {
    const author = await account();
    const viewer = await account();
    const created = [];
    for (let i = 0; i < 3; i++)
      created.push(await createPost(author, `пост ${i}`));
    const url = path(postsEndpoints.byUser.path, { id: author.id });
    const first = PostListResponseSchema.parse(
      (await viewer.client.get(`${url}?limit=2`).expect(200)).body,
    );
    const second = PostListResponseSchema.parse(
      (
        await viewer.client
          .get(`${url}?limit=2&cursor=${first.nextCursor}`)
          .expect(200)
      ).body,
    );
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(
      created.map((post) => post.id).reverse(),
    );
    expect(
      (
        await viewer.client.get(
          path(postsEndpoints.byUser.path, { id: randomUUID() }),
        )
      ).status,
    ).toBe(404);
  });

  it('lets only the author delete a post and stops serving its files at once', async () => {
    const author = await account();
    const other = await account();
    const post = await createPost(author);
    const url = path(postsEndpoints.remove.path, { id: post.id });
    const foreign = await send(other, 'delete', url);
    expect(foreign.status).toBe(404);
    expect(errorCode(foreign.body)).toBe('POST_NOT_FOUND');
    await other.client.get(post.image.url).expect(200);

    expect((await send(author, 'delete', url)).body).toEqual({
      status: 'deleted',
    });
    for (const who of [author, other]) {
      expect(
        (await who.client.get(path(postsEndpoints.get.path, { id: post.id })))
          .status,
      ).toBe(404);
      expect((await who.client.get(post.image.url)).status).toBe(404);
    }
    expect(await files(mediaId(post.image.url))).toEqual([]);
    expect(
      await database.prisma.media.count({
        where: { id: mediaId(post.image.url) },
      }),
    ).toBe(0);
    expect((await send(author, 'delete', url)).status).toBe(404);
  });

  it('sets, replaces and removes an avatar visible with the profile summary', async () => {
    const owner = await account({ isPrivate: true });
    const stranger = await account();
    const set = await upload(owner, postsEndpoints.setAvatar.path, 'put', {
      data: await jpeg(600, 600),
    });
    expect(set.status).toBe(200);
    const first = AvatarResponseSchema.parse(set.body).avatarUrl!;
    const profileUrl = path(usersEndpoints.profile.path, {
      username: owner.username,
    });
    expect(
      UserProfileResponseSchema.parse(
        (await stranger.client.get(profileUrl).expect(200)).body,
      ).profile.avatarUrl,
    ).toBe(first);
    // Avatars follow the profile summary: visible even for a private account.
    await stranger.client.get(first).expect(200);

    const replaced = AvatarResponseSchema.parse(
      (
        await upload(owner, postsEndpoints.setAvatar.path, 'put', {
          data: await png(),
          type: 'image/png',
          name: 'a.png',
        })
      ).body,
    ).avatarUrl!;
    expect(replaced).not.toBe(first);
    expect((await stranger.client.get(first)).status).toBe(404);
    expect(await files(mediaId(first))).toEqual([]);
    await stranger.client.get(replaced).expect(200);

    expect(
      (await send(owner, 'delete', postsEndpoints.removeAvatar.path)).body,
    ).toEqual({ avatarUrl: null });
    expect((await stranger.client.get(replaced)).status).toBe(404);
    expect(
      UserProfileResponseSchema.parse(
        (await stranger.client.get(profileUrl).expect(200)).body,
      ).profile.avatarUrl,
    ).toBeNull();
  });

  it('cleans up abandoned uploads and deleted media repeatably', async () => {
    const owner = await account();
    const stale = await database.prisma.media.create({
      data: {
        ownerId: owner.id,
        kind: 'POST',
        createdAt: new Date(Date.now() - 2 * 3600_000),
      },
    });
    const fresh = await database.prisma.media.create({
      data: { ownerId: owner.id, kind: 'POST' },
    });
    for (const { id } of [stale, fresh]) {
      await mkdir(join(root, id), { recursive: true });
      await writeFile(join(root, id, 'full.webp'), 'partial');
    }
    const media = app.get(MediaService);
    await media.cleanup();
    await media.cleanup();
    expect(
      await database.prisma.media.findUnique({ where: { id: stale.id } }),
    ).toBeNull();
    expect(await files(stale.id)).toEqual([]);
    // A recent PENDING upload may still be in progress.
    expect(
      await database.prisma.media.findUnique({ where: { id: fresh.id } }),
    ).not.toBeNull();
    expect(await files(fresh.id)).toEqual(['full.webp']);
  });
});
