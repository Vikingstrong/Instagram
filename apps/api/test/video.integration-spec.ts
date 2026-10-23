import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  PostResponseSchema,
  authEndpoints,
  postsEndpoints,
  type Post,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { MediaService } from '../src/media/media.service.js';
import { ffmpegPath, VideoProcessor } from '../src/media/video-processor.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
const ffmpeg = promisify(execFile);
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string };
const postUrl = (id: string) => postsEndpoints.get.path.replace('{id}', id);

describe('Video posts with real PostgreSQL and ffmpeg', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let media: MediaService;
  let root: string;
  let clip: Buffer;
  let long: Buffer;
  const ownedIds: string[] = [];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'instagram-video-api-'));
    process.env.MEDIA_ROOT = root;
    // Synthetic clips made by the pinned ffmpeg: no binary fixtures in Git.
    const make = async (name: string, args: string[]) => {
      const file = join(root, name);
      await ffmpeg(ffmpegPath(), ['-hide_banner', '-y', ...args, file]);
      const data = await readFile(file);
      await rm(file);
      return data;
    };
    clip = await make('clip.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-shortest',
    ]);
    long = await make('long.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=1:duration=95',
      '-c:v',
      'libx264',
    ]);
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
    media = app.get(MediaService);
  }, 60_000);
  afterAll(async () => {
    try {
      await media.idle();
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
  async function account(): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `v_${suffix.slice(0, 20)}`,
        password: 'synthetic video password',
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    await database.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    return { client, id: user.id };
  }
  async function upload(
    who: Account,
    data: Buffer,
    options: { field?: string; caption?: string; csrf?: boolean } = {},
  ) {
    // The token is read before the request is built: awaiting inside a
    // supertest chain loses its server.
    const token = options.csrf === false ? undefined : await csrf(who.client);
    let req = who.client
      .post(postsEndpoints.createVideo.path)
      .set('Origin', origin);
    if (token) req = req.set('X-CSRF-Token', token);
    if (options.caption !== undefined)
      req = req.field('caption', options.caption);
    return req.attach(options.field ?? 'video', data, {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
    });
  }
  const errorCode = (body: unknown) =>
    AuthApiErrorResponseSchema.parse(body).error.code;
  const incoming = async () => {
    try {
      return await readdir(join(root, '.incoming'));
    } catch {
      return [];
    }
  };
  const read = async (who: Account, id: string) => {
    const response = await who.client.get(postUrl(id));
    return response.status === 200
      ? PostResponseSchema.parse(response.body).post
      : response.status;
  };
  const mediaId = (post: Post) => post.image.url.split('/')[4]!;

  it('requires a session, CSRF and the video field', async () => {
    const anonymous = request.agent(app.getHttpServer());
    expect(
      (
        await anonymous
          .post(postsEndpoints.createVideo.path)
          .set('Origin', origin)
          .attach('video', clip, 'clip.mp4')
      ).status,
    ).toBe(401);
    const owner = await account();
    expect((await upload(owner, clip, { csrf: false })).status).toBe(403);
    const wrongField = await upload(owner, clip, { field: 'image' });
    expect(wrongField.status).toBe(400);
    expect(errorCode(wrongField.body)).toBe('INVALID_REQUEST');
    expect(await incoming()).toEqual([]);
  });

  it('publishes after processing; only the author sees it before', async () => {
    const owner = await account();
    const other = await account();
    const response = await upload(owner, clip, { caption: 'Первое видео' });
    expect(response.status).toBe(201);
    const created = PostResponseSchema.parse(response.body).post;
    expect(created).toMatchObject({
      type: 'video',
      status: 'processing',
      video: null,
      caption: 'Первое видео',
      image: { width: 640, height: 360 },
    });
    expect(await read(other, created.id)).toBe(404);
    expect(await read(owner, created.id)).toMatchObject({
      status: 'processing',
    });

    await media.idle();
    const ready = (await read(owner, created.id)) as Post;
    expect(ready.status).toBe('ready');
    expect(ready.video?.url).toBe(`/api/v1/media/${mediaId(ready)}/video`);
    expect(Math.abs(ready.video!.durationMs - 2000)).toBeLessThan(150);
    expect(await read(other, created.id)).toMatchObject({ status: 'ready' });
    expect((await readdir(join(root, mediaId(ready)))).sort()).toEqual([
      'full.webp',
      'thumb.webp',
      'video.mp4',
    ]);
    // The uploaded original and the work directory are gone.
    expect(await incoming()).toEqual([]);
  }, 60_000);

  it('rejects oversize, overlong and damaged videos without leftovers', async () => {
    const owner = await account();
    const huge = await upload(owner, Buffer.alloc(100 * 1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    expect(errorCode(huge.body)).toBe('VIDEO_TOO_LARGE');
    const tooLong = await upload(owner, long);
    expect(tooLong.status).toBe(400);
    expect(errorCode(tooLong.body)).toBe('VIDEO_TOO_LONG');
    const damaged = await upload(owner, randomBytes(64 * 1024));
    expect(damaged.status).toBe(400);
    expect(errorCode(damaged.body)).toBe('INVALID_VIDEO');
    expect(
      await database.prisma.post.count({ where: { authorId: owner.id } }),
    ).toBe(0);
    expect(await incoming()).toEqual([]);
  }, 120_000);

  it('shows a failed processing to the author only and cleans it up later', async () => {
    const owner = await account();
    const other = await account();
    vi.spyOn(app.get(VideoProcessor), 'process').mockRejectedValueOnce(
      new Error('encoder crashed'),
    );
    const created = PostResponseSchema.parse(
      (await upload(owner, clip)).body,
    ).post;
    await media.idle();
    expect(await read(owner, created.id)).toMatchObject({ status: 'failed' });
    expect(await read(other, created.id)).toBe(404);
    expect(await incoming()).toEqual([]);

    await media.cleanup(new Date(Date.now() + 2 * 3600_000));
    expect(await read(owner, created.id)).toBe(404);
    expect(
      await database.prisma.media.count({ where: { id: mediaId(created) } }),
    ).toBe(0);
  }, 60_000);

  it('discards the result when the post is deleted during processing', async () => {
    const owner = await account();
    const created = PostResponseSchema.parse(
      (await upload(owner, clip)).body,
    ).post;
    const token = await csrf(owner.client);
    await owner.client
      .delete(postUrl(created.id))
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({})
      .expect(200);
    await media.idle();
    await media.cleanup();
    expect(
      await database.prisma.media.count({ where: { id: mediaId(created) } }),
    ).toBe(0);
    expect(await readdir(root)).not.toContain(mediaId(created));
  }, 60_000);

  it('marks videos interrupted by a restart as failed', async () => {
    const owner = await account();
    const row = await database.prisma.media.create({
      data: {
        ownerId: owner.id,
        kind: 'POST',
        type: 'VIDEO',
        width: 640,
        height: 360,
      },
    });
    const post = await database.prisma.post.create({
      data: { authorId: owner.id, mediaId: row.id, caption: '' },
    });
    expect(await read(owner, post.id)).toMatchObject({ status: 'processing' });
    expect(await media.failInterruptedVideos()).toBeGreaterThanOrEqual(1);
    expect(await read(owner, post.id)).toMatchObject({ status: 'failed' });
  });
});
