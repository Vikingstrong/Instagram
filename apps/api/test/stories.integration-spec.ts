import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  StoryResponseSchema,
  StoryFeedResponseSchema,
  StoryListResponseSchema,
  StoryViewersResponseSchema,
  type Story,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { MediaService } from '../src/media/media.service.js';
import { ffmpegPath } from '../src/media/video-processor.js';
import { StoriesService } from '../src/stories/stories.service.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string };
describe('FR-13 Stories: actual PostgreSQL, private files and video pipeline', () => {
  let app: INestApplication<App>,
    db: DatabaseService,
    media: MediaService,
    root: string,
    image: Buffer;
  const ids: string[] = [];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'instagram-stories-'));
    process.env.MEDIA_ROOT = root;
    image = await sharp({
      create: { width: 800, height: 1200, channels: 3, background: '#ff9900' },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: 'private' } })
      .toBuffer();
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
    db = app.get(DatabaseService);
    media = app.get(MediaService);
  }, 30_000);
  afterAll(async () => {
    try {
      await media.idle();
      await db.prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await app.close();
      delete process.env.MEDIA_ROOT;
      await rm(root, { recursive: true, force: true });
    }
  });
  async function account(isPrivate = false, verified = true): Promise<Account> {
    const client = request.agent(app.getHttpServer()),
      suffix = randomUUID().replaceAll('-', '');
    const csrf = (await client.get('/api/v1/auth/csrf').expect(200)).body
      .csrfToken as string;
    const result = await client
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        email: `story-${suffix}@example.test`,
        username: `s_${suffix.slice(0, 20)}`,
        password: 'story fixture password',
      })
      .expect(201);
    const id = result.body.user.id as string;
    ids.push(id);
    await db.prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: verified ? new Date() : null, isPrivate },
    });
    return { client, id };
  }
  async function token(who: Account) {
    return (await who.client.get('/api/v1/auth/csrf').expect(200)).body
      .csrfToken as string;
  }
  async function upload(who: Account, data = image) {
    const csrf = await token(who);
    return who.client
      .post('/api/v1/stories')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .attach('image', data, 'photo.jpg');
  }
  async function create(who: Account): Promise<Story> {
    const result = await upload(who);
    expect(result.status).toBe(201);
    return StoryResponseSchema.parse(result.body).story;
  }
  async function mutate(
    who: Account,
    method: 'post' | 'delete',
    path: string,
    body: object = {},
  ) {
    const csrf = await token(who);
    return who.client[method](path)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send(body);
  }
  async function follow(
    who: Account,
    owner: Account,
    status: 'PENDING' | 'ACCEPTED' = 'ACCEPTED',
  ) {
    await db.prisma.follow.create({
      data: {
        followerId: who.id,
        followeeId: owner.id,
        status,
        acceptedAt: status === 'ACCEPTED' ? new Date() : null,
      },
    });
  }
  async function expire(story: Story) {
    const expiresAt = new Date(Date.now() - 1000);
    await db.prisma.story.update({
      where: { id: story.id },
      data: {
        createdAt: new Date(expiresAt.getTime() - 24 * 3600_000),
        expiresAt,
      },
    });
  }
  it('publishes a 24h photo, strips EXIF, serves private no-store variants and never creates a post', async () => {
    const owner = await account(),
      story = await create(owner);
    expect(
      new Date(story.expiresAt).getTime() - new Date(story.createdAt).getTime(),
    ).toBe(24 * 3600_000);
    expect(story).toMatchObject({
      type: 'photo',
      status: 'ready',
      viewed: false,
    });
    expect(await db.prisma.post.count({ where: { authorId: owner.id } })).toBe(
      0,
    );
    const response = await owner.client.get(story.image.url).expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const metadata = await sharp(response.body as Buffer).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe('webp');
    await owner.client.get(story.image.thumbnailUrl).expect(200);
    await request(app.getHttpServer()).get(story.image.url).expect(401);
  });
  it('requires verified session, CSRF, correct content and rejects injected fields', async () => {
    const owner = await account(),
      unverified = await account(false, false);
    await request(app.getHttpServer()).get('/api/v1/stories/feed').expect(401);
    await unverified.client.get('/api/v1/stories/feed').expect(403);
    await owner.client
      .post('/api/v1/stories')
      .attach('image', image, 'x.jpg')
      .expect(403);
    expect((await upload(owner, Buffer.from('not an image'))).status).toBe(400);
    const csrf = await token(owner);
    const bad = await owner.client
      .post('/api/v1/stories')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .field('authorId', owner.id)
      .attach('image', image, 'x.jpg');
    expect(bad.status).toBe(400);
    expect(
      (await upload(owner, Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    ).toBe(413);
    await owner.client.get('/api/v1/stories/not-a-uuid').expect(400);
    await owner.client.get('/api/v1/stories/feed?limit=51').expect(400);
    await owner.client.get('/api/v1/stories/feed?cursor=bad').expect(400);
  });
  it('denies a private story and every file to strangers and pending followers; revokes access after removal', async () => {
    const owner = await account(true),
      viewer = await account(),
      stranger = await account();
    const story = await create(owner);
    await follow(viewer, owner, 'PENDING');
    for (const who of [viewer, stranger]) {
      await who.client.get(`/api/v1/stories/${story.id}`).expect(404);
      await who.client.get(story.image.url).expect(404);
      expect(
        (await who.client.get(`/api/v1/users/${owner.id}/stories`)).body.items,
      ).toEqual([]);
      expect(
        (await mutate(who, 'post', `/api/v1/stories/${story.id}/views`)).status,
      ).toBe(404);
    }
    await db.prisma.follow.update({
      where: {
        followerId_followeeId: { followerId: viewer.id, followeeId: owner.id },
      },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    await viewer.client.get(`/api/v1/stories/${story.id}`).expect(200);
    await viewer.client.get(story.image.url).expect(200);
    await db.prisma.follow.delete({
      where: {
        followerId_followeeId: { followerId: viewer.id, followeeId: owner.id },
      },
    });
    await viewer.client.get(story.image.url).expect(404);
    await viewer.client.get(story.image.thumbnailUrl).expect(404);
    await viewer.client.get(`/api/v1/stories/${story.id}`).expect(404);
    expect(
      (await mutate(stranger, 'delete', `/api/v1/stories/${story.id}`)).status,
    ).toBe(404);
  });
  it('groups only own/followed READY active stories; pages groups and author stories without duplicates', async () => {
    const owner = await account(),
      viewer = await account(),
      other = await account();
    await follow(viewer, owner);
    const one = await create(owner),
      two = await create(owner),
      own = await create(viewer);
    await create(other);
    const first = StoryFeedResponseSchema.parse(
      (await viewer.client.get('/api/v1/stories/feed?limit=1').expect(200))
        .body,
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = StoryFeedResponseSchema.parse(
      (
        await viewer.client
          .get(`/api/v1/stories/feed?limit=1&cursor=${first.nextCursor}`)
          .expect(200)
      ).body,
    );
    expect(
      new Set([...first.items, ...second.items].map((g) => g.author.id)),
    ).toEqual(new Set([owner.id, viewer.id]));
    expect(second.nextCursor).toBeNull();
    const list = StoryListResponseSchema.parse(
      (
        await viewer.client
          .get(`/api/v1/users/${owner.id}/stories?limit=1`)
          .expect(200)
      ).body,
    );
    const rest = StoryListResponseSchema.parse(
      (
        await viewer.client
          .get(
            `/api/v1/users/${owner.id}/stories?limit=1&cursor=${list.nextCursor}`,
          )
          .expect(200)
      ).body,
    );
    expect([list.items[0]!.id, rest.items[0]!.id]).toEqual([one.id, two.id]);
    expect(own.author.id).toBe(viewer.id);
  });
  it('records concurrent/repeated views exactly once, keeps first time, and exposes viewers only to the author', async () => {
    const owner = await account(),
      viewer = await account(),
      other = await account();
    const story = await create(owner);
    await follow(viewer, owner);
    const csrf = await token(viewer);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        viewer.client
          .post(`/api/v1/stories/${story.id}/views`)
          .set('Origin', origin)
          .set('X-CSRF-Token', csrf)
          .send({}),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const before = await db.prisma.storyView.findUniqueOrThrow({
      where: { storyId_userId: { storyId: story.id, userId: viewer.id } },
    });
    expect(
      (await mutate(viewer, 'post', `/api/v1/stories/${story.id}/views`))
        .status,
    ).toBe(200);
    const after = await db.prisma.storyView.findUniqueOrThrow({
      where: { storyId_userId: { storyId: story.id, userId: viewer.id } },
    });
    expect(after.viewedAt).toEqual(before.viewedAt);
    await mutate(owner, 'post', `/api/v1/stories/${story.id}/views`);
    const ownerRead = StoryResponseSchema.parse(
      (await owner.client.get(`/api/v1/stories/${story.id}`)).body,
    );
    expect(ownerRead.story.viewed).toBe(true);
    await mutate(other, 'post', `/api/v1/stories/${story.id}/views`);
    const list = StoryViewersResponseSchema.parse(
      (
        await owner.client
          .get(`/api/v1/stories/${story.id}/viewers?limit=1`)
          .expect(200)
      ).body,
    );
    expect(list.total).toBe(2);
    expect(list.items).toHaveLength(1);
    expect(list.nextCursor).not.toBeNull();
    const last = StoryViewersResponseSchema.parse(
      (
        await owner.client
          .get(
            `/api/v1/stories/${story.id}/viewers?limit=1&cursor=${list.nextCursor}`,
          )
          .expect(200)
      ).body,
    );
    expect(last.items).toHaveLength(1);
    expect(last.items[0]!.user.id).not.toBe(list.items[0]!.user.id);
    await viewer.client.get(`/api/v1/stories/${story.id}/viewers`).expect(404);
    const feed = StoryFeedResponseSchema.parse(
      (await viewer.client.get('/api/v1/stories/feed')).body,
    );
    expect(feed.items.find((g) => g.author.id === owner.id)?.hasUnseen).toBe(
      false,
    );
    const read = StoryResponseSchema.parse(
      (await viewer.client.get(`/api/v1/stories/${story.id}`)).body,
    );
    expect(read.story.viewed).toBe(true);
  });
  it('expires before cleanup: story, feed, views and all direct files immediately become inaccessible', async () => {
    const owner = await account(),
      viewer = await account();
    const story = await create(owner);
    await follow(viewer, owner);
    await expire(story);
    await owner.client.get(`/api/v1/stories/${story.id}`).expect(404);
    await viewer.client.get(story.image.url).expect(404);
    await owner.client.get(story.image.thumbnailUrl).expect(404);
    expect(
      (await viewer.client.get('/api/v1/stories/feed')).body.items.some(
        (g: { author: { id: string } }) => g.author.id === owner.id,
      ),
    ).toBe(false);
    expect(
      (await mutate(viewer, 'post', `/api/v1/stories/${story.id}/views`))
        .status,
    ).toBe(404);
    await owner.client.get(`/api/v1/stories/${story.id}/viewers`).expect(404);
    const mediaId = story.image.url.split('/')[4]!;
    expect(await media.read(mediaId, 'full')).not.toBeNull();
    await app.get(StoriesService).cleanup();
    expect(
      await db.prisma.story.findUnique({ where: { id: story.id } }),
    ).toBeNull();
    expect(await media.read(mediaId, 'full')).toBeNull();
    expect(await media.read(mediaId, 'thumb')).toBeNull();
    await app.get(StoriesService).cleanup();
  });
  it('deletes own story, cascades audience and removes files without waiting for cleanup', async () => {
    const owner = await account(),
      viewer = await account();
    const story = await create(owner);
    await mutate(viewer, 'post', `/api/v1/stories/${story.id}/views`);
    expect(
      (await mutate(owner, 'delete', `/api/v1/stories/${story.id}`)).status,
    ).toBe(200);
    await owner.client.get(story.image.url).expect(404);
    expect(
      await db.prisma.storyView.count({ where: { storyId: story.id } }),
    ).toBe(0);
    expect(await media.read(story.image.url.split('/')[4]!, 'full')).toBeNull();
  });
  it('rolls back a failed story transaction and discards the prepared image', async () => {
    const owner = await account();
    const before = await readdir(root);
    const spy = vi
      .spyOn(db.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('synthetic failure'));
    try {
      expect((await upload(owner)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await db.prisma.story.count({ where: { authorId: owner.id } })).toBe(
      0,
    );
    expect(await readdir(root)).toEqual(before);
  });
  it('keeps an attached processing story out of orphan cleanup and cleans failed stories through their owner', async () => {
    const owner = await account();
    const pending = await db.prisma.media.create({
      data: {
        ownerId: owner.id,
        kind: 'STORY',
        type: 'VIDEO',
        width: 160,
        height: 240,
        createdAt: new Date(Date.now() - 2 * 3600_000),
      },
    });
    const row = await db.prisma.story.create({
      data: { authorId: owner.id, mediaId: pending.id },
    });
    await media.cleanup();
    expect(
      await db.prisma.media.findUnique({ where: { id: pending.id } }),
    ).not.toBeNull();
    const processing = StoryResponseSchema.parse(
      (await owner.client.get(`/api/v1/stories/${row.id}`).expect(200)).body,
    ).story;
    expect(processing.status).toBe('processing');
    await owner.client.get(processing.image.url).expect(404);
    await db.prisma.media.update({
      where: { id: pending.id },
      data: { failedAt: new Date(Date.now() - 2 * 3600_000) },
    });
    const failed = StoryResponseSchema.parse(
      (await owner.client.get(`/api/v1/stories/${row.id}`).expect(200)).body,
    ).story;
    expect(failed.status).toBe('failed');
    await app.get(StoriesService).cleanup();
    expect(
      await db.prisma.story.findUnique({ where: { id: row.id } }),
    ).toBeNull();
    expect(
      await db.prisma.media.findUnique({ where: { id: pending.id } }),
    ).toBeNull();
  });

  it('processes a real video, gates processing, streams ranges, expires video and cleans originals', async () => {
    const owner = await account(true),
      viewer = await account();
    await follow(viewer, owner);
    const file = join(root, 'synthetic.mp4');
    await promisify(execFile)(ffmpegPath(), [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x240:d=1',
      '-c:v',
      'libx264',
      file,
    ]);
    const clip = await readFile(file);
    await rm(file);
    const csrf = await token(owner);
    const created = await owner.client
      .post('/api/v1/stories/video')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .attach('video', clip, 'clip.mp4')
      .expect(201);
    const pending = StoryResponseSchema.parse(created.body).story;
    expect(pending.status).toBe('processing');
    const own = await owner.client
      .get(`/api/v1/stories/${pending.id}`)
      .expect(200);
    expect(own.body.story.author.id).toBe(owner.id);
    await media.idle();
    const story = StoryResponseSchema.parse(
      (await viewer.client.get(`/api/v1/stories/${pending.id}`).expect(200))
        .body,
    ).story;
    expect(story.status).toBe('ready');
    expect(story.video?.durationMs).toBeGreaterThan(0);
    const range = await viewer.client
      .get(story.video!.url)
      .set('Range', 'bytes=0-31')
      .expect(206);
    expect(range.headers['content-range']).toMatch(/^bytes 0-31\//);
    expect(range.headers['cache-control']).toBe('private, no-store');
    await db.prisma.follow.delete({
      where: {
        followerId_followeeId: { followerId: viewer.id, followeeId: owner.id },
      },
    });
    await viewer.client
      .get(story.video!.url)
      .set('Range', 'bytes=32-63')
      .expect(404);
    await expire(story);
    await owner.client.get(story.video!.url).expect(404);
    await app.get(StoriesService).cleanup();
    expect(
      await db.prisma.story.findUnique({ where: { id: story.id } }),
    ).toBeNull();
    expect(
      (await readdir(await media.incomingDir())).filter((n) =>
        n.endsWith('.upload'),
      ),
    ).toEqual([]);
  }, 30_000);
});
