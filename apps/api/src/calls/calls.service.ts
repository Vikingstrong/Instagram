import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  CallSchema,
  type CallSignal,
  type StartCallRequest,
  type CallActionRequest,
  type PageQuery,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionRevocations } from '../auth/session-revocations.js';
import { DirectService } from '../direct/direct.service.js';
import { DirectEvents } from '../direct/direct-events.js';
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
} from './calls.config.js';
const select = {
  caller: { select: summarySelect },
  callee: { select: summarySelect },
} as const;
type Row = Prisma.CallGetPayload<{ include: typeof select }>;
const active = ['RINGING', 'ACTIVE'] as const;
const member = (userId: string) => ({
  OR: [{ callerId: userId }, { calleeId: userId }],
});
type Signal = { sequence: number; sender: string; signal: CallSignal };
@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private readonly buffers = new Map<string, Signal[]>();
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DirectService) private readonly direct: DirectService,
    @Inject(DirectEvents) private readonly events: DirectEvents,
    @Inject(SessionRevocations)
    private readonly revocations: SessionRevocations,
    @Inject(CALLS_CONFIG) private readonly config: CallsConfig,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () => void this.sweep().catch(() => undefined),
      5000,
    );
    this.timer.unref();
    this.unsubscribe = this.revocations.subscribe((event) => {
      void this.db.prisma.call
        .findMany({
          where: {
            status: { in: [...active] },
            ...('userId' in event
              ? member(event.userId)
              : {
                  OR: [
                    { callerSessionHash: event.tokenHash },
                    { calleeSessionHash: event.tokenHash },
                  ],
                }),
          },
          include: select,
        })
        .then((rows) =>
          Promise.all(rows.map((row) => this.finish(row, 'ENDED'))),
        )
        .catch(() => undefined);
    });
  }
  onModuleDestroy() {
    clearInterval(this.timer);
    this.unsubscribe?.();
    this.buffers.clear();
  }
  private dto(row: Row, userId: string) {
    return CallSchema.parse({
      id: row.id,
      conversationId: row.conversationId,
      callerId: row.callerId,
      peer: userSummary(row.callerId === userId ? row.callee : row.caller),
      kind: row.kind,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      answeredAt: row.answeredAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
    });
  }
  private async require(userId: string, id: string) {
    const row = await this.db.prisma.call.findFirst({
      where: { id, ...member(userId) },
      include: select,
    });
    if (!row) throw new AuthError('CALL_NOT_FOUND');
    return row;
  }
  private owner(row: Row, userId: string, hash: string, clientId: string) {
    const caller = row.callerId === userId;
    if (
      (caller ? row.callerSessionHash : row.calleeSessionHash) !== hash ||
      (caller ? row.callerClientId : row.calleeClientId) !== clientId
    )
      throw new AuthError('CALL_STATE_CONFLICT');
  }
  private notice(row: Row) {
    this.events.notifyCall([row.callerId, row.calleeId], { callId: row.id });
  }
  async start(userId: string, hash: string, input: StartCallRequest) {
    iceConfiguration(this.config, userId);
    const conversation = await this.direct.get(userId, input.conversationId);
    if (
      !(await this.db.prisma.user.count({
        where: { id: conversation.peer.id, emailVerifiedAt: { not: null } },
      }))
    )
      throw new AuthError('USER_NOT_FOUND');
    const existing = await this.db.prisma.call.findUnique({
      where: { id: input.id },
      include: select,
    });
    if (existing) {
      if (
        existing.callerId !== userId ||
        existing.conversationId !== input.conversationId ||
        existing.kind !== input.kind
      )
        throw new AuthError('CALL_STATE_CONFLICT');
      this.owner(existing, userId, hash, input.clientId);
      return this.dto(existing, userId);
    }
    let row: Row;
    try {
      row = await this.db.prisma.$transaction(async (tx) => {
        const call = await tx.call.create({
          data: {
            id: input.id,
            conversationId: input.conversationId,
            callerId: userId,
            calleeId: conversation.peer.id,
            callerSessionHash: hash,
            callerClientId: input.clientId,
            kind: input.kind,
          },
          include: select,
        });
        await tx.callSeat.createMany({
          data: [userId, conversation.peer.id]
            .sort()
            .map((userId) => ({ userId, callId: call.id })),
        });
        await this.direct.callActivity(tx, input.conversationId);
        return call;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        const saved = await this.db.prisma.call.findUnique({
          where: { id: input.id },
          include: select,
        });
        if (
          saved &&
          saved.callerId === userId &&
          saved.conversationId === input.conversationId &&
          saved.kind === input.kind &&
          saved.callerSessionHash === hash &&
          saved.callerClientId === input.clientId
        )
          return this.dto(saved, userId);
        throw new AuthError('CALL_BUSY');
      }
      throw error;
    }
    this.buffers.set(row.id, []);
    this.notice(row);
    return this.dto(row, userId);
  }
  async get(userId: string, id: string) {
    return this.dto(await this.require(userId, id), userId);
  }
  async current(userId: string) {
    const seat = await this.db.prisma.callSeat.findUnique({
      where: { userId },
      select: { call: { include: select } },
    });
    return seat ? this.dto(seat.call, userId) : null;
  }
  private async finish(
    row: Row,
    status: 'ENDED' | 'DECLINED' | 'MISSED' | 'FAILED',
    leaseCheck = false,
  ) {
    const changed = await this.db.prisma.$transaction(async (tx) => {
      const result = await tx.call.updateMany({
        where: {
          id: row.id,
          status: { in: [...active] },
          ...(leaseCheck
            ? { callerSeenAt: row.callerSeenAt, calleeSeenAt: row.calleeSeenAt }
            : {}),
        },
        data: { status, endedAt: new Date() },
      });
      if (result.count) {
        await tx.callSeat.deleteMany({ where: { callId: row.id } });
        await this.direct.callActivity(tx, row.conversationId);
      }
      return result.count;
    });
    if (changed) {
      this.buffers.delete(row.id);
      this.notice(row);
    }
  }
  async action(
    userId: string,
    hash: string,
    id: string,
    input: CallActionRequest,
  ) {
    const row = await this.require(userId, id);
    if (input.action === 'accept') {
      if (row.calleeId !== userId) throw new AuthError('CALL_STATE_CONFLICT');
      if (row.status === 'ACTIVE')
        this.owner(row, userId, hash, input.clientId);
      else if (row.status !== 'RINGING')
        throw new AuthError('CALL_STATE_CONFLICT');
      else {
        await this.db.prisma.call.updateMany({
          where: { id, status: 'RINGING' },
          data: {
            status: 'ACTIVE',
            answeredAt: new Date(),
            calleeSeenAt: new Date(),
            calleeSessionHash: hash,
            calleeClientId: input.clientId,
          },
        });
        this.owner(
          await this.require(userId, id),
          userId,
          hash,
          input.clientId,
        );
        this.notice(row);
      }
    } else {
      if (input.action === 'decline' && row.calleeId !== userId)
        throw new AuthError('CALL_STATE_CONFLICT');
      if (input.action === 'decline' && row.status === 'ACTIVE')
        throw new AuthError('CALL_STATE_CONFLICT');
      await this.finish(
        row,
        input.action === 'decline'
          ? 'DECLINED'
          : input.action === 'fail'
            ? 'FAILED'
            : 'ENDED',
      );
    }
    return this.dto(await this.require(userId, id), userId);
  }
  async heartbeat(userId: string, hash: string, id: string, clientId: string) {
    const row = await this.require(userId, id);
    this.owner(row, userId, hash, clientId);
    await this.db.prisma.call.updateMany({
      where: { id, status: { in: [...active] } },
      data:
        row.callerId === userId
          ? { callerSeenAt: new Date() }
          : { calleeSeenAt: new Date() },
    });
    return this.dto(await this.require(userId, id), userId);
  }
  async sendSignal(
    userId: string,
    hash: string,
    id: string,
    clientId: string,
    signal: CallSignal,
  ) {
    const row = await this.require(userId, id);
    this.owner(row, userId, hash, clientId);
    if (
      row.status !== 'ACTIVE' ||
      (signal.type === 'offer' && row.callerId !== userId) ||
      (signal.type === 'answer' && row.calleeId !== userId)
    )
      throw new AuthError('CALL_STATE_CONFLICT');
    const buffer = this.buffers.get(id);
    if (
      !buffer ||
      buffer.length >= 512 ||
      buffer.reduce(
        (bytes, item) => bytes + JSON.stringify(item.signal).length,
        0,
      ) +
        JSON.stringify(signal).length >
        262144
    )
      throw new AuthError('CALL_STATE_CONFLICT');
    buffer.push({ sequence: buffer.length + 1, sender: userId, signal });
    this.notice(row);
  }
  async signals(
    userId: string,
    hash: string,
    id: string,
    clientId: string,
    after: number,
  ) {
    const row = await this.require(userId, id);
    this.owner(row, userId, hash, clientId);
    if (row.status !== 'ACTIVE') throw new AuthError('CALL_STATE_CONFLICT');
    const buffer = this.buffers.get(id);
    if (!buffer) throw new AuthError('CALL_STATE_CONFLICT');
    return {
      items: buffer
        .filter((item) => item.sequence > after && item.sender !== userId)
        .map(({ sequence, signal }) => ({ sequence, signal })),
      next: buffer.length,
    };
  }
  async history(userId: string, conversationId: string, page: PageQuery) {
    await this.direct.get(userId, conversationId);
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.db.prisma.call.findMany({
      where: {
        conversationId,
        ...(after && {
          OR: [
            { createdAt: { lt: after.date } },
            { createdAt: after.date, id: { lt: after.id } },
          ],
        }),
      },
      include: select,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit),
      last = items.at(-1);
    return {
      items: items.map((row) => this.dto(row, userId)),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    };
  }
  async sweep() {
    const now = Date.now();
    const rows = await this.db.prisma.call.findMany({
      where: {
        OR: [
          { status: 'RINGING', createdAt: { lt: new Date(now - 45000) } },
          {
            status: 'ACTIVE',
            OR: [
              { callerSeenAt: { lt: new Date(now - 20000) } },
              { calleeSeenAt: { lt: new Date(now - 20000) } },
            ],
          },
        ],
      },
      include: select,
    });
    for (const row of rows)
      await this.finish(
        row,
        row.status === 'RINGING' ? 'MISSED' : 'FAILED',
        true,
      );
    if (this.buffers.size) {
      const live = new Set(
        (
          await this.db.prisma.call.findMany({
            where: {
              id: { in: [...this.buffers.keys()] },
              status: { in: [...active] },
            },
            select: { id: true },
          })
        ).map((row) => row.id),
      );
      for (const id of this.buffers.keys())
        if (!live.has(id)) this.buffers.delete(id);
    }
  }
}
