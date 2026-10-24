import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  LiveCommentSchema,
  LiveGiftSchema,
  LiveSchema,
  liveGiftPrice,
  liveRules,
  type CallSignal,
  type CreateLiveCommentRequest,
  type SendLiveGiftRequest,
  type StartLiveRequest,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';
import {
  SessionRevocations,
  type SessionRevocation,
} from '../auth/session-revocations.js';
import { DirectEvents } from '../direct/direct-events.js';
import { visibleAuthor } from '../posts/post-policy.js';
import {
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from '../users/user-summary.js';
import {
  CALLS_CONFIG,
  iceConfiguration,
  type CallsConfig,
} from '../calls/calls.config.js';
import { CoinsService } from '../coins/coins.service.js';
import { LiveRooms } from './live-rooms.js';

export const LIVES_CONFIG = Symbol('LIVES_CONFIG');
export type LivesConfig = {
  // A host or viewer without a heartbeat for this long is gone.
  leaseMs: number;
  // Lease, duration and access re-check period.
  sweepMs: number;
  maxDurationMs: number;
  maxViewers: number;
  // Ended streams are kept this long so late viewers see "ended".
  keepEndedMs: number;
};
export const defaultLivesConfig: LivesConfig = {
  leaseMs: 20_000,
  sweepMs: 5000,
  maxDurationMs: liveRules.maxDurationMinutes * 60_000,
  maxViewers: liveRules.maxViewers,
  keepEndedMs: 86_400_000,
};

const select = { host: { select: summarySelect } } as const;
type Row = Prisma.LiveGetPayload<{ include: typeof select }>;
type EndReason = 'HOST' | 'LOST' | 'SIGNED_OUT' | 'TIME_LIMIT';
const commentSelect = { author: { select: summarySelect } } as const;
const giftSelect = { sender: { select: summarySelect } } as const;
const page = 50;

export function liveIceConfiguration(config: CallsConfig, userId: string) {
  // Without TURN, viewers behind NAT could not connect at all.
  if (config.production && !config.turn.length)
    throw new AuthError('LIVES_UNAVAILABLE');
  return iceConfiguration(config, userId);
}

// FR-12 live streams (P-15 proposal, stage 10). The stream state and chat
// are in PostgreSQL; viewer connections and SDP/ICE are in memory. Who may
// watch and chat is the author's post rule (post-policy.ts), checked on
// every viewer request and re-checked for connected viewers by the sweep.
@Injectable()
export class LivesService implements OnModuleInit, OnModuleDestroy {
  private readonly rooms = new LiveRooms();
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DirectEvents) private readonly events: DirectEvents,
    @Inject(SessionRevocations)
    private readonly revocations: SessionRevocations,
    @Inject(CALLS_CONFIG) private readonly ice: CallsConfig,
    @Inject(LIVES_CONFIG) private readonly config: LivesConfig,
    @Inject(CoinsService) private readonly coins: CoinsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.sweep().catch(() => undefined),
      this.config.sweepMs,
    );
    this.timer.unref();
    this.unsubscribe = this.revocations.subscribe(
      (revocation) => void this.revoke(revocation).catch(() => undefined),
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.unsubscribe?.();
    this.rooms.clear();
  }

  iceServers(userId: string) {
    return liveIceConfiguration(this.ice, userId);
  }

  private dto(row: Row) {
    return LiveSchema.parse({
      id: row.id,
      host: userSummary(row.host),
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      viewerCount: row.status === 'LIVE' ? this.rooms.count(row.id) : 0,
    });
  }

  private async visible(viewerId: string, hostId: string) {
    return (
      (await this.db.prisma.user.count({
        where: { id: hostId, ...visibleAuthor(viewerId) },
      })) > 0
    );
  }

  // The stream as the viewer may see it. A viewer who lost access is also
  // disconnected, so the host stops sending media at its next sync.
  private async require(viewerId: string, id: string) {
    const row = await this.db.prisma.live.findUnique({
      where: { id },
      include: select,
    });
    if (row && (await this.visible(viewerId, row.hostId))) return row;
    if (row && this.rooms.removeUser(row.id, viewerId))
      this.notify(row.id, row.hostId);
    throw new AuthError('LIVE_NOT_FOUND');
  }

  private owner(row: Row, hash: string, clientId: string) {
    if (row.hostSessionHash !== hash || row.hostClientId !== clientId)
      throw new AuthError('LIVE_STATE_CONFLICT');
  }

  private notify(liveId: string, hostId: string, others: string[] = []) {
    this.events.notifyLive(
      [
        hostId,
        ...this.rooms.viewers(liveId).map((peer) => peer.userId),
        ...others,
      ],
      { liveId },
    );
  }

  private async followers(hostId: string) {
    return (
      await this.db.prisma.follow.findMany({
        where: { followeeId: hostId, status: 'ACCEPTED' },
        select: { followerId: true },
      })
    ).map((row) => row.followerId);
  }

  async start(userId: string, hash: string, input: StartLiveRequest) {
    this.iceServers(userId);
    const same = (row: Row | null): row is Row =>
      !!row &&
      row.hostId === userId &&
      row.hostSessionHash === hash &&
      row.hostClientId === input.clientId;
    const existing = await this.db.prisma.live.findUnique({
      where: { id: input.id },
      include: select,
    });
    if (existing) {
      if (!same(existing)) throw new AuthError('LIVE_STATE_CONFLICT');
      return this.dto(existing);
    }
    let row: Row;
    try {
      row = await this.db.prisma.live.create({
        data: {
          id: input.id,
          hostId: userId,
          activeHostId: userId,
          hostSessionHash: hash,
          hostClientId: input.clientId,
        },
        include: select,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const saved = await this.db.prisma.live.findUnique({
          where: { id: input.id },
          include: select,
        });
        if (same(saved)) return this.dto(saved);
        throw new AuthError(saved ? 'LIVE_STATE_CONFLICT' : 'LIVE_BUSY');
      }
      throw error;
    }
    this.rooms.room(row.id, userId);
    this.notify(row.id, userId, await this.followers(userId));
    return this.dto(row);
  }

  async current(userId: string) {
    const row = await this.db.prisma.live.findUnique({
      where: { activeHostId: userId },
      include: select,
    });
    return row ? this.dto(row) : null;
  }

  // Streams of followed accounts and one's own; newest first.
  async list(viewerId: string) {
    const rows = await this.db.prisma.live.findMany({
      where: {
        status: 'LIVE',
        host: {
          emailVerifiedAt: { not: null },
          OR: [
            { id: viewerId },
            {
              followers: {
                some: { followerId: viewerId, status: 'ACCEPTED' },
              },
            },
          ],
        },
      },
      include: select,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: page,
    });
    return rows.map((row) => this.dto(row));
  }

  // null both when nobody is on air and when the viewer may not see the
  // author: a private account's stream is not revealed.
  async byHost(viewerId: string, hostId: string) {
    const row = await this.db.prisma.live.findUnique({
      where: { activeHostId: hostId },
      include: select,
    });
    return row && (await this.visible(viewerId, row.hostId))
      ? this.dto(row)
      : null;
  }

  async get(viewerId: string, id: string) {
    return this.dto(await this.require(viewerId, id));
  }

  private async finish(row: Row, reason: EndReason, leaseCheck = false) {
    const changed = await this.db.prisma.$transaction(async (tx) => {
      const result = await tx.live.updateMany({
        where: {
          id: row.id,
          status: 'LIVE',
          ...(leaseCheck ? { hostSeenAt: row.hostSeenAt } : {}),
        },
        data: {
          status: 'ENDED',
          activeHostId: null,
          endedAt: new Date(),
          endReason: reason,
        },
      });
      // Live streams are not recorded: the chat goes with the stream.
      if (result.count)
        await tx.liveComment.deleteMany({ where: { liveId: row.id } });
      return result.count;
    });
    if (!changed) return;
    const viewers = this.rooms.drop(row.id);
    this.events.notifyLive(
      [row.hostId, ...viewers, ...(await this.followers(row.hostId))],
      { liveId: row.id },
    );
  }

  // Any session of the host may end the stream, e.g. after a reload.
  async end(userId: string, id: string) {
    const row = await this.require(userId, id);
    if (row.hostId !== userId) throw new AuthError('LIVE_STATE_CONFLICT');
    await this.finish(row, 'HOST');
    return this.get(userId, id);
  }

  async heartbeat(userId: string, hash: string, id: string, clientId: string) {
    const row = await this.require(userId, id);
    if (row.hostId === userId) {
      this.owner(row, hash, clientId);
      await this.db.prisma.live.updateMany({
        where: { id, status: 'LIVE' },
        data: { hostSeenAt: new Date() },
      });
      return this.get(userId, id);
    }
    if (row.status !== 'LIVE') return this.dto(row);
    const peer = this.rooms.peerOf(id, userId, hash, clientId);
    if (!peer) throw new AuthError('LIVE_STATE_CONFLICT');
    peer.seenAt = Date.now();
    return this.dto(row);
  }

  async join(userId: string, hash: string, id: string, clientId: string) {
    this.iceServers(userId);
    const row = await this.require(userId, id);
    if (row.hostId === userId) throw new AuthError('LIVE_STATE_CONFLICT');
    if (row.status !== 'LIVE') throw new AuthError('LIVE_ENDED');
    const user = await this.db.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: summarySelect,
    });
    const peer = this.rooms.join(
      id,
      row.hostId,
      { userId, hash, clientId, user: userSummary(user) },
      this.config.maxViewers,
    );
    this.notify(id, row.hostId);
    return { live: this.dto(row), peerId: peer.peerId };
  }

  leave(userId: string, hash: string, id: string, clientId: string) {
    const peer = this.rooms.peerOf(id, userId, hash, clientId);
    const hostId = this.rooms.hostOf(id);
    if (peer && hostId && this.rooms.remove(id, peer.peerId))
      this.notify(id, hostId, [userId]);
  }

  async sendSignal(
    userId: string,
    hash: string,
    id: string,
    clientId: string,
    peerId: string,
    signal: CallSignal,
  ) {
    const row = await this.require(userId, id);
    if (row.status !== 'LIVE') throw new AuthError('LIVE_ENDED');
    if (row.hostId === userId) {
      this.owner(row, hash, clientId);
      if (signal.type === 'offer') throw new AuthError('LIVE_STATE_CONFLICT');
      const peer = this.rooms.toPeer(id, peerId, signal);
      this.events.notifyLive([peer.userId], { liveId: id });
      return;
    }
    const peer = this.rooms.peerOf(id, userId, hash, clientId);
    if (!peer || peer.peerId !== peerId || signal.type === 'answer')
      throw new AuthError('LIVE_STATE_CONFLICT');
    this.rooms.toHost(id, peerId, signal);
    this.events.notifyLive([row.hostId], { liveId: id });
  }

  async signals(
    userId: string,
    hash: string,
    id: string,
    clientId: string,
    after: number,
  ) {
    const row = await this.require(userId, id);
    if (row.status !== 'LIVE') throw new AuthError('LIVE_ENDED');
    if (row.hostId === userId) {
      this.owner(row, hash, clientId);
      return this.rooms.hostRead(id, row.hostId, after);
    }
    const peer = this.rooms.peerOf(id, userId, hash, clientId);
    if (!peer) throw new AuthError('LIVE_STATE_CONFLICT');
    return this.rooms.peerRead(peer, after);
  }

  private comment(
    row: Prisma.LiveCommentGetPayload<{ include: typeof commentSelect }>,
  ) {
    return LiveCommentSchema.parse({
      id: row.id,
      author: userSummary(row.author),
      text: row.text,
      createdAt: row.createdAt.toISOString(),
    });
  }

  // Chat order is (createdAt, id). Without a cursor: the latest page.
  async comments(viewerId: string, id: string, cursor?: string) {
    await this.require(viewerId, id);
    const after = decodeCursor(cursor, 'date');
    const rows = after
      ? await this.db.prisma.liveComment.findMany({
          where: {
            liveId: id,
            OR: [
              { createdAt: { gt: after.date } },
              { createdAt: after.date, id: { gt: after.id } },
            ],
          },
          include: commentSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: page,
        })
      : (
          await this.db.prisma.liveComment.findMany({
            where: { liveId: id },
            include: commentSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: page,
          })
        ).reverse();
    const last = rows.at(-1);
    return {
      items: rows.map((row) => this.comment(row)),
      next: last
        ? encodeCursor(last.createdAt.toISOString(), last.id)
        : (cursor ?? null),
    };
  }

  async addComment(
    userId: string,
    id: string,
    input: CreateLiveCommentRequest,
  ) {
    const row = await this.require(userId, id);
    if (row.status !== 'LIVE') throw new AuthError('LIVE_ENDED');
    let saved;
    try {
      saved = await this.db.prisma.liveComment.create({
        data: { id: input.id, liveId: id, authorId: userId, text: input.text },
        include: commentSelect,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      saved = await this.db.prisma.liveComment.findUnique({
        where: { id: input.id },
        include: commentSelect,
      });
      // A retry returns the stored line; another payload is a conflict.
      if (
        saved?.liveId !== id ||
        saved.authorId !== userId ||
        saved.text !== input.text
      )
        throw new AuthError('MESSAGE_ID_CONFLICT');
      return this.comment(saved);
    }
    this.notify(id, row.hostId);
    return this.comment(saved);
  }

  private gift(row: Prisma.LiveGiftGetPayload<{ include: typeof giftSelect }>) {
    return LiveGiftSchema.parse({
      id: row.id,
      giftKey: row.giftKey,
      price: row.price,
      sender: userSummary(row.sender),
      createdAt: row.createdAt.toISOString(),
    });
  }

  // Gifts in (createdAt, id) order, like the chat. They outlive the stream.
  async gifts(viewerId: string, id: string, cursor?: string) {
    await this.require(viewerId, id);
    const after = decodeCursor(cursor, 'date');
    const rows = after
      ? await this.db.prisma.liveGift.findMany({
          where: {
            liveId: id,
            OR: [
              { createdAt: { gt: after.date } },
              { createdAt: after.date, id: { gt: after.id } },
            ],
          },
          include: giftSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: page,
        })
      : (
          await this.db.prisma.liveGift.findMany({
            where: { liveId: id },
            include: giftSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: page,
          })
        ).reverse();
    const last = rows.at(-1);
    return {
      items: rows.map((row) => this.gift(row)),
      next: last
        ? encodeCursor(last.createdAt.toISOString(), last.id)
        : (cursor ?? null),
    };
  }

  // FR-14: the viewer pays the catalog price, the host receives all of it.
  // The stream row is locked first, so ending the stream and a gift are
  // ordered: a gift either lands while LIVE or is refused without a charge.
  async sendGift(userId: string, id: string, input: SendLiveGiftRequest) {
    const price = liveGiftPrice(input.giftKey);
    const replay = <T extends { liveId: string; giftKey: string }>(
      saved: T | null,
    ) => {
      if (saved && (saved.liveId !== id || saved.giftKey !== input.giftKey))
        throw new AuthError('COINS_OPERATION_CONFLICT');
      return saved;
    };
    // A retry after a lost response returns the committed gift, even when
    // the stream has ended since.
    let saved = replay(
      await this.db.prisma.liveGift.findUnique({
        where: {
          senderId_idempotencyKey: {
            senderId: userId,
            idempotencyKey: input.id,
          },
        },
        include: giftSelect,
      }),
    );
    let hostId: string | undefined;
    if (!saved)
      saved = await this.db.prisma.$transaction(async (tx) => {
        const [live] = await tx.$queryRaw<
          { hostId: string; status: 'LIVE' | 'ENDED' }[]
        >`SELECT "hostId", "status" FROM "lives" WHERE "id" = ${id}::uuid FOR UPDATE`;
        if (
          !live ||
          !(await tx.user.count({
            where: { id: live.hostId, ...visibleAuthor(userId) },
          }))
        )
          throw new AuthError('LIVE_NOT_FOUND');
        if (live.status !== 'LIVE') throw new AuthError('LIVE_ENDED');
        if (live.hostId === userId) throw new AuthError('LIVE_STATE_CONFLICT');
        hostId = live.hostId;
        const { receipt, replayed } = await this.coins.transferGift(tx, {
          senderId: userId,
          recipientId: live.hostId,
          amount: String(price),
          streamId: id,
          giftKey: input.giftKey,
          idempotencyKey: input.id,
        });
        // A concurrent retry committed first: its row is already here.
        if (replayed)
          return replay(
            await tx.liveGift.findUnique({
              where: { id: receipt.id },
              include: giftSelect,
            }),
          );
        return tx.liveGift.create({
          data: {
            id: receipt.id,
            liveId: id,
            senderId: userId,
            idempotencyKey: input.id,
            giftKey: input.giftKey,
            price,
            createdAt: new Date(receipt.createdAt),
          },
          include: giftSelect,
        });
      });
    if (!saved) throw new AuthError('COINS_OPERATION_CONFLICT');
    if (hostId) this.notify(id, hostId);
    return {
      gift: this.gift(saved),
      balance: (await this.coins.wallet(userId)).balance,
    };
  }

  // Viewer connections of the session end synchronously, before the logout
  // response; the host's stream ends right after.
  private async revoke(revocation: SessionRevocation) {
    for (const liveId of this.rooms.removeWhere((peer) =>
      'userId' in revocation
        ? peer.userId === revocation.userId
        : peer.hash === revocation.tokenHash,
    )) {
      const hostId = this.rooms.hostOf(liveId);
      if (hostId) this.notify(liveId, hostId);
    }
    const rows = await this.db.prisma.live.findMany({
      where: {
        status: 'LIVE',
        ...('userId' in revocation
          ? { hostId: revocation.userId }
          : { hostSessionHash: revocation.tokenHash }),
      },
      include: select,
    });
    for (const row of rows) await this.finish(row, 'SIGNED_OUT');
  }

  // Ends streams whose host went silent or ran out of time, drops viewers
  // without a heartbeat or without access any more, forgets old streams.
  async sweep(now = Date.now()) {
    const lost = new Date(now - this.config.leaseMs),
      limit = new Date(now - this.config.maxDurationMs);
    const rows = await this.db.prisma.live.findMany({
      where: {
        status: 'LIVE',
        OR: [{ hostSeenAt: { lt: lost } }, { startedAt: { lt: limit } }],
      },
      include: select,
    });
    for (const row of rows)
      await this.finish(
        row,
        row.startedAt < limit ? 'TIME_LIMIT' : 'LOST',
        true,
      );
    const ids = this.rooms.ids();
    if (ids.length) {
      const live = new Set(
        (
          await this.db.prisma.live.findMany({
            where: { id: { in: ids }, status: 'LIVE' },
            select: { id: true },
          })
        ).map((row) => row.id),
      );
      for (const liveId of ids) {
        if (!live.has(liveId)) {
          this.rooms.drop(liveId);
          continue;
        }
        const hostId = this.rooms.hostOf(liveId)!;
        const removed: string[] = [];
        for (const peer of this.rooms.viewers(liveId))
          if (
            peer.seenAt < now - this.config.leaseMs ||
            !(await this.visible(peer.userId, hostId))
          ) {
            this.rooms.remove(liveId, peer.peerId);
            removed.push(peer.userId);
          }
        if (removed.length) this.notify(liveId, hostId, removed);
      }
    }
    // A stream with gifts stays: it is the context of their coin transfers.
    await this.db.prisma.live.deleteMany({
      where: {
        status: 'ENDED',
        endedAt: { lt: new Date(now - this.config.keepEndedMs) },
        gifts: { none: {} },
      },
    });
  }
}
