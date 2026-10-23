import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthUserResponseSchema,
  CommentListResponseSchema,
  CommentResponseSchema,
  LikeResponseSchema,
  PostListResponseSchema,
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
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
type Agent = ReturnType<typeof request.agent>;
type Account = { client: Agent; id: string; username: string };
const path = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key]!);

describe('Feed, likes and comments with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let root: string;
  let image: Buffer;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'instagram-feed-'));
    process.env.MEDIA_ROOT = root;
    image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#a53a6e' },
    })
      .jpeg()
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
  async function account(isPrivate = false): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const token = await csrf(client);
    const response = await client
      .post(authEndpoints.register.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: `${suffix}@example.test`,
        username: `f_${suffix.slice(0, 20)}`,
        password: 'synthetic feed password',
      })
      .expect(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    await database.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), isPrivate },
    });
    return { client, id: user.id, username: user.username };
  }
  const follow = (follower: Account, followee: Account, accepted = true) =>
    database.prisma.follow.create({
      data: {
        followerId: follower.id,
        followeeId: followee.id,
        status: accepted ? 'ACCEPTED' : 'PENDING',
        acceptedAt: accepted ? new Date() : null,
      },
    });
  const unfollow = (follower: Account, followee: Account) =>
    database.prisma.follow.deleteMany({
      where: { followerId: follower.id, followeeId: followee.id },
    });
  async function post(who: Account, caption: string): Promise<Post> {
    const token = await csrf(who.client);
    const response = await who.client
      .post(postsEndpoints.create.path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .field('caption', caption)
      .attach('image', image, {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      });
    return PostResponseSchema.parse(response.body).post;
  }
  async function send(
    who: Account,
    method: 'post' | 'put' | 'delete',
    url: string,
    body: object = {},
  ) {
    const token = await csrf(who.client);
    return who.client[method](url)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  async function feed(who: Account, query = '') {
    const response = await who.client
      .get(postsEndpoints.feed.path + query)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return PostListResponseSchema.parse(response.body);
  }
  const errorCode = (body: unknown) =>
    AuthApiErrorResponseSchema.parse(body).error.code;
  const likeUrl = (id: string) => path(postsEndpoints.like.path, { id });
  const commentsUrl = (id: string) =>
    path(postsEndpoints.comments.path, { id });
  const commentUrl = (id: string) =>
    path(postsEndpoints.removeComment.path, { id });

  it('builds the feed from own posts and approved followings only', async () => {
    const viewer = await account();
    const friend = await account();
    const stranger = await account();
    const closed = await account(true);
    await follow(viewer, friend);
    await follow(viewer, closed, false);
    const own = await post(viewer, 'мой');
    const theirs = await post(friend, 'друга');
    await post(stranger, 'чужой');
    await post(closed, 'закрытый');

    const anonymous = await request(app.getHttpServer()).get(
      postsEndpoints.feed.path,
    );
    expect(anonymous.status).toBe(401);
    expect((await feed(viewer)).items.map((item) => item.id)).toEqual([
      theirs.id,
      own.id,
    ]);
    expect(await feed(await account())).toEqual({
      items: [],
      nextCursor: null,
    });

    // Approval adds the private author's posts; unfollowing removes a
    // followee's posts at once, before paging.
    await database.prisma.follow.updateMany({
      where: { followerId: viewer.id, followeeId: closed.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    expect((await feed(viewer)).items.map((item) => item.caption)).toEqual([
      'закрытый',
      'друга',
      'мой',
    ]);
    await unfollow(viewer, friend);
    await unfollow(viewer, closed);
    expect((await feed(viewer)).items.map((item) => item.id)).toEqual([own.id]);
  });

  it('pages without duplicates across equal timestamps and new posts', async () => {
    const viewer = await account();
    const created: Post[] = [];
    for (let index = 0; index < 5; index++)
      created.push(await post(viewer, `p${index}`));
    // Same timestamp for all: the id breaks ties.
    await database.prisma.post.updateMany({
      where: { id: { in: created.map((item) => item.id) } },
      data: { createdAt: new Date('2020-01-01T08:00:00.000Z') },
    });
    const first = await feed(viewer, '?limit=2');
    expect(first.items).toHaveLength(2);
    await post(viewer, 'новый между страницами');
    const seen = first.items.map((item) => item.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await feed(viewer, `?limit=2&cursor=${cursor}`);
      seen.push(...next.items.map((item) => item.id));
      cursor = next.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(new Set(seen)).toEqual(new Set(created.map((item) => item.id)));
    expect(
      (await viewer.client.get(postsEndpoints.feed.path + '?cursor=@@')).status,
    ).toBe(400);
  });

  it('keeps at most one like per user and reports the viewer state', async () => {
    const author = await account();
    const fan = await account();
    const target = await post(author, 'лайки');
    expect(target).toMatchObject({
      likeCount: 0,
      commentCount: 0,
      liked: false,
    });

    const noCsrf = await fan.client
      .put(likeUrl(target.id))
      .set('Origin', origin)
      .send({});
    expect(noCsrf.status).toBe(403);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => send(fan, 'put', likeUrl(target.id))),
    );
    for (const result of results) expect(result.status).toBe(200);
    expect(
      LikeResponseSchema.parse(
        (await send(fan, 'put', likeUrl(target.id))).body,
      ),
    ).toEqual({
      liked: true,
      likeCount: 1,
    });
    await send(author, 'put', likeUrl(target.id));
    const seen = PostResponseSchema.parse(
      (await fan.client.get(path(postsEndpoints.get.path, { id: target.id })))
        .body,
    ).post;
    expect(seen).toMatchObject({ likeCount: 2, liked: true });

    for (let index = 0; index < 2; index++)
      expect(
        LikeResponseSchema.parse(
          (await send(fan, 'delete', likeUrl(target.id))).body,
        ),
      ).toEqual({ liked: false, likeCount: 1 });
    expect((await feed(author)).items[0]).toMatchObject({
      id: target.id,
      likeCount: 1,
      liked: true,
    });
  });

  it('allows likes and comments only on posts the viewer may see', async () => {
    const owner = await account(true);
    const outsider = await account();
    const requester = await account();
    await follow(requester, owner, false);
    const hidden = await post(owner, 'закрытый пост');
    for (const who of [outsider, requester]) {
      const like = await send(who, 'put', likeUrl(hidden.id));
      expect(like.status).toBe(404);
      expect(errorCode(like.body)).toBe('POST_NOT_FOUND');
      expect(
        (await send(who, 'post', commentsUrl(hidden.id), { text: 'привет' }))
          .status,
      ).toBe(404);
      expect((await who.client.get(commentsUrl(hidden.id))).status).toBe(404);
    }
    expect((await send(outsider, 'put', likeUrl(randomUUID()))).status).toBe(
      404,
    );
    expect(
      await database.prisma.postLike.count({ where: { postId: hidden.id } }),
    ).toBe(0);
    expect(
      await database.prisma.comment.count({ where: { postId: hidden.id } }),
    ).toBe(0);
  });

  it('validates comments, lists them oldest first and applies delete rights', async () => {
    const author = await account(true);
    const follower = await account();
    const other = await account();
    await follow(follower, author);
    await follow(other, author);
    const target = await post(author, 'обсуждение');

    for (const text of ['', '   \n ', 'x'.repeat(2201), 'tab\t'])
      expect(
        (await send(follower, 'post', commentsUrl(target.id), { text })).status,
      ).toBe(400);
    expect(
      (
        await send(follower, 'post', commentsUrl(target.id), {
          text: 'ok',
          authorId: author.id,
        })
      ).status,
    ).toBe(400);

    const added = await send(follower, 'post', commentsUrl(target.id), {
      text: 'Первый\nкомментарий',
    });
    expect(added.status).toBe(201);
    const first = CommentResponseSchema.parse(added.body).comment;
    expect(first).toMatchObject({
      postId: target.id,
      text: 'Первый\nкомментарий',
      canDelete: true,
      author: { id: follower.id },
    });
    const second = CommentResponseSchema.parse(
      (
        await send(other, 'post', commentsUrl(target.id), {
          text: '🙂'.repeat(2200),
        })
      ).body,
    ).comment;
    const third = CommentResponseSchema.parse(
      (await send(author, 'post', commentsUrl(target.id), { text: 'спасибо' }))
        .body,
    ).comment;

    const asOther = CommentListResponseSchema.parse(
      (await other.client.get(commentsUrl(target.id) + '?limit=2')).body,
    );
    expect(asOther.items.map((item) => [item.id, item.canDelete])).toEqual([
      [first.id, false],
      [second.id, true],
    ]);
    const rest = CommentListResponseSchema.parse(
      (
        await other.client.get(
          `${commentsUrl(target.id)}?limit=2&cursor=${asOther.nextCursor}`,
        )
      ).body,
    );
    expect(rest).toEqual({
      items: [expect.objectContaining({ id: third.id, canDelete: false })],
      nextCursor: null,
    });
    const asAuthor = CommentListResponseSchema.parse(
      (await author.client.get(commentsUrl(target.id))).body,
    );
    expect(asAuthor.items.every((item) => item.canDelete)).toBe(true);
    expect(
      PostResponseSchema.parse(
        (
          await author.client.get(
            path(postsEndpoints.get.path, { id: target.id }),
          )
        ).body,
      ).post.commentCount,
    ).toBe(3);

    // Others may not delete foreign comments; a hidden post answers 404.
    const forbidden = await send(other, 'delete', commentUrl(first.id));
    expect(forbidden.status).toBe(403);
    expect(errorCode(forbidden.body)).toBe('CANNOT_DELETE_COMMENT');
    const stranger = await account();
    const hiddenDelete = await send(stranger, 'delete', commentUrl(first.id));
    expect(hiddenDelete.status).toBe(404);
    expect(errorCode(hiddenDelete.body)).toBe('COMMENT_NOT_FOUND');

    // The post author removes any comment under the post.
    expect((await send(author, 'delete', commentUrl(second.id))).status).toBe(
      200,
    );
    expect((await send(author, 'delete', commentUrl(second.id))).status).toBe(
      404,
    );

    // P-10: after losing access the comment author can still delete their
    // own comment, but can no longer read the post or its comments.
    await unfollow(follower, author);
    expect((await follower.client.get(commentsUrl(target.id))).status).toBe(
      404,
    );
    expect((await send(follower, 'delete', commentUrl(first.id))).status).toBe(
      200,
    );
    expect(
      await database.prisma.comment.findMany({
        where: { postId: target.id },
        select: { id: true },
      }),
    ).toEqual([{ id: third.id }]);
  });

  it('removes likes and comments together with the post', async () => {
    const author = await account();
    const fan = await account();
    const target = await post(author, 'удалится');
    await send(fan, 'put', likeUrl(target.id));
    await send(fan, 'post', commentsUrl(target.id), { text: 'пока' });
    expect(
      (
        await send(
          author,
          'delete',
          path(postsEndpoints.remove.path, { id: target.id }),
        )
      ).status,
    ).toBe(200);
    expect(
      await database.prisma.postLike.count({ where: { postId: target.id } }),
    ).toBe(0);
    expect(
      await database.prisma.comment.count({ where: { postId: target.id } }),
    ).toBe(0);
    expect((await send(fan, 'put', likeUrl(target.id))).status).toBe(404);
  });
  it('flattens replies, binds the recipient on the server and pages three at a time', async () => {
    const author = await account();
    const reader = await account();
    const target = await post(author, 'ветка');
    const root = CommentResponseSchema.parse(
      (await send(author, 'post', commentsUrl(target.id), { text: 'root' }))
        .body,
    ).comment;
    const addReply = async (
      who: Account,
      replyToCommentId: string,
      text: string,
    ) => {
      const response = await send(who, 'post', commentsUrl(target.id), {
        text,
        replyToCommentId,
      });
      expect(response.status).toBe(201);
      return CommentResponseSchema.parse(response.body).comment;
    };
    const first = await addReply(reader, root.id, 'one');
    const second = await addReply(author, first.id, 'two');
    expect(first).toMatchObject({
      parentId: root.id,
      replyTo: { id: author.id },
    });
    expect(second).toMatchObject({
      parentId: root.id,
      replyTo: { id: reader.id },
    });
    await addReply(reader, second.id, 'three');
    await addReply(reader, root.id, 'four');
    // Stable pagination when every reply has the same timestamp.
    await database.prisma.comment.updateMany({
      where: { parentId: root.id },
      data: { createdAt: new Date('2026-10-23T10:00:00.000Z') },
    });
    const orderedReplies = await database.prisma.comment.findMany({
      where: { parentId: root.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const roots = CommentListResponseSchema.parse(
      (await reader.client.get(commentsUrl(target.id))).body,
    );
    expect(roots.items).toHaveLength(1);
    expect(roots.items[0]).toMatchObject({ id: root.id, replyCount: 4 });
    const url = path(postsEndpoints.replies.path, { id: root.id });
    const firstPage = CommentListResponseSchema.parse(
      (await reader.client.get(url + '?limit=50')).body,
    );
    expect(firstPage.items).toHaveLength(3);
    expect(firstPage.nextCursor).not.toBeNull();
    const lastPage = CommentListResponseSchema.parse(
      (await reader.client.get(url + '?cursor=' + firstPage.nextCursor)).body,
    );
    expect(
      [...firstPage.items, ...lastPage.items].map((item) => item.id),
    ).toEqual(orderedReplies.map((item) => item.id));
    expect(lastPage.nextCursor).toBeNull();
    expect(
      new Set([...firstPage.items, ...lastPage.items].map((item) => item.id))
        .size,
    ).toBe(4);
    expect(
      (
        await reader.client.get(
          path(postsEndpoints.replies.path, { id: first.id }),
        )
      ).status,
    ).toBe(404);
    const another = await post(author, 'другой');
    expect(
      (
        await send(reader, 'post', commentsUrl(another.id), {
          text: 'no',
          replyToCommentId: root.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(reader, 'post', commentsUrl(target.id), {
          text: 'no',
          replyToCommentId: root.id,
          replyToUserId: author.id,
        })
      ).status,
    ).toBe(400);
    await expect(
      database.prisma.comment.create({
        data: {
          postId: target.id,
          authorId: reader.id,
          text: 'invalid depth',
          parentId: first.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.comment.create({
        data: {
          postId: another.id,
          authorId: reader.id,
          text: 'wrong post',
          parentId: root.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.comment.update({
        where: { id: second.id },
        data: { parentId: null },
      }),
    ).rejects.toThrow();
    await send(
      reader,
      'put',
      path(postsEndpoints.likeComment.path, { id: second.id }),
    );
    await send(
      reader,
      'put',
      path(postsEndpoints.likeComment.path, { id: root.id }),
    );
    // A reply can be removed by the post author; removing a root removes its thread.
    expect((await send(author, 'delete', commentUrl(first.id))).status).toBe(
      200,
    );
    expect((await reader.client.get(url)).body.items).toHaveLength(3);
    expect(
      (await reader.client.get(url)).body.items.find(
        (item: { id: string }) => item.id === second.id,
      ),
    ).toMatchObject({ replyTo: { id: reader.id } });
    expect((await send(author, 'delete', commentUrl(root.id))).status).toBe(
      200,
    );
    expect(
      await database.prisma.comment.count({ where: { postId: target.id } }),
    ).toBe(0);
    expect(
      await database.prisma.commentLike.count({
        where: { commentId: { in: [root.id, second.id] } },
      }),
    ).toBe(0);
  });

  it('keeps one comment like under concurrent requests, revokes access and cascades likes', async () => {
    const author = await account(true);
    const fan = await account();
    const stranger = await account();
    await follow(fan, author);
    const target = await post(author, 'private');
    const root = CommentResponseSchema.parse(
      (await send(author, 'post', commentsUrl(target.id), { text: 'root' }))
        .body,
    ).comment;
    const reply = CommentResponseSchema.parse(
      (
        await send(fan, 'post', commentsUrl(target.id), {
          text: 'reply',
          replyToCommentId: root.id,
        })
      ).body,
    ).comment;
    const url = path(postsEndpoints.likeComment.path, { id: reply.id });
    // Use one CSRF cookie/token for all concurrent requests from the same browser.
    const token = await csrf(fan.client);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        fan.client
          .put(url)
          .set('Origin', origin)
          .set('X-CSRF-Token', token)
          .send({}),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await database.prisma.commentLike.count({
        where: { commentId: reply.id },
      }),
    ).toBe(1);
    expect((await send(fan, 'put', url)).body).toEqual({
      liked: true,
      likeCount: 1,
    });
    expect(
      (await fan.client.get(path(postsEndpoints.replies.path, { id: root.id })))
        .body.items[0],
    ).toMatchObject({ liked: true, likeCount: 1 });
    expect((await send(fan, 'delete', url)).body).toEqual({
      liked: false,
      likeCount: 0,
    });
    expect((await send(fan, 'delete', url)).body).toEqual({
      liked: false,
      likeCount: 0,
    });
    expect((await send(stranger, 'put', url)).status).toBe(404);
    expect(
      (
        await request(app.getHttpServer()).get(
          path(postsEndpoints.replies.path, { id: root.id }),
        )
      ).status,
    ).toBe(401);
    expect((await fan.client.put(url).send({})).status).toBe(403);
    await send(fan, 'put', url);
    await unfollow(fan, author);
    expect(
      (await fan.client.get(path(postsEndpoints.replies.path, { id: root.id })))
        .status,
    ).toBe(404);
    expect((await send(fan, 'put', url)).status).toBe(404);
    expect((await send(fan, 'delete', url)).status).toBe(404);
    expect(
      (
        await send(fan, 'post', commentsUrl(target.id), {
          text: 'no',
          replyToCommentId: reply.id,
        })
      ).status,
    ).toBe(404);
    // P-10 still permits deleting one's own reply after losing access.
    expect((await send(fan, 'delete', commentUrl(reply.id))).status).toBe(200);
    expect(
      await database.prisma.commentLike.count({
        where: { commentId: reply.id },
      }),
    ).toBe(0);
  });
});
