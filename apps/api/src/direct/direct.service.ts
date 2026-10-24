import { createHash } from 'node:crypto';
import { MediaService } from '../media/media.service.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  ConversationSchema,
  DirectMessageSchema,
  type Conversation,
  type DirectMessage,
  type PageQuery,
  type SendMessageRequest,
  type ShareContentRequest,
  type SharedContent,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';
import {
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from '../users/user-summary.js';
import {
  SharedContentService,
  sharedKind,
  wireKind,
} from './shared-content.service.js';
import { DirectEvents } from './direct-events.js';

const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  clientMessageId: true,
  text: true,
  createdAt: true,
  media: {
    select: {
      id: true,
      type: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
  sourceHash: true,
  sharedKind: true,
  sharedTargetId: true,
  sharedPostId: true,
  sharedStoryId: true,
} as const;

type MessageRow = Prisma.DirectMessageGetPayload<{
  select: typeof messageSelect;
}>;

const conversationSelect = {
  id: true,
  userAId: true,
  lastActivityAt: true,
  userA: { select: summarySelect },
  userB: { select: summarySelect },
  calls: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      kind: true,
      status: true,
      callerId: true,
      createdAt: true,
      endedAt: true,
    },
  },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: messageSelect,
  },
} as const satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{
  select: typeof conversationSelect;
}>;

function attachmentUrl(
  row: { conversationId: string; id: string },
  variant: string,
) {
  return `/api/v1/direct/conversations/${row.conversationId}/messages/${row.id}/${variant}`;
}

function toMessage(
  row: MessageRow,
  sharedContent?: SharedContent,
): DirectMessage {
  return DirectMessageSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    clientMessageId: row.clientMessageId,
    text: row.text,
    sharedContent: row.sharedKind
      ? (sharedContent ?? {
          kind: wireKind[row.sharedKind],
          status: 'unavailable',
        })
      : null,
    attachment: row.media
      ? row.media.type === 'AUDIO'
        ? {
            type: 'voice',
            url: attachmentUrl(row, 'audio'),
            opusUrl: attachmentUrl(row, 'opus'),
            durationMs: row.media.durationMs!,
          }
        : {
            type: 'image',
            url: attachmentUrl(row, 'full'),
            thumbnailUrl: attachmentUrl(row, 'thumb'),
            width: row.media.width!,
            height: row.media.height!,
          }
      : null,
    createdAt: row.createdAt.toISOString(),
  });
}

function toConversation(
  viewerId: string,
  row: ConversationRow,
  refs: Map<string, SharedContent>,
): Conversation {
  const last = row.messages[0];
  return ConversationSchema.parse({
    id: row.id,
    peer: userSummary(row.userAId === viewerId ? row.userB : row.userA),
    lastMessage: last ? toMessage(last, refs.get(last.id)) : null,
    lastCall: row.calls[0]
      ? {
          ...row.calls[0],
          createdAt: row.calls[0].createdAt.toISOString(),
          endedAt: row.calls[0].endedAt?.toISOString() ?? null,
        }
      : null,
    lastActivityAt: row.lastActivityAt.toISOString(),
  });
}

// Pairs are stored ordered so the unique key covers both directions.
const orderedPair = (first: string, second: string) =>
  first < second
    ? { userAId: first, userBId: second }
    : { userAId: second, userBId: first };

const participant = (viewerId: string): Prisma.ConversationWhereInput => ({
  OR: [{ userAId: viewerId }, { userBId: viewerId }],
});

const uniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// FR-09 over REST. Only the two participants can read or write a
// conversation; anyone else gets 404, so its existence is not confirmed.
// Message text is never logged.
@Injectable()
export class DirectService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(SharedContentService) private readonly shared: SharedContentService,
    @Inject(DirectEvents) private readonly events: DirectEvents,
  ) {}

  async callActivity(tx: Prisma.TransactionClient, conversationId: string) {
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastActivityAt: new Date() },
    });
  }

  // Any verified user may write to any other verified user (FR-09),
  // regardless of follows or privacy. Repeats and races return the same
  // conversation thanks to the unique pair.
  async open(viewerId: string, userId: string): Promise<Conversation> {
    if (userId === viewerId) throw new AuthError('CANNOT_MESSAGE_SELF');
    const peer = await this.database.prisma.user.findFirst({
      where: { id: userId, emailVerifiedAt: { not: null } },
      select: { id: true },
    });
    if (!peer) throw new AuthError('USER_NOT_FOUND');
    const pair = orderedPair(viewerId, userId);
    const find = () =>
      this.database.prisma.conversation.findUnique({
        where: { userAId_userBId: pair },
        select: conversationSelect,
      });
    let row = await find();
    if (!row) {
      try {
        row = await this.database.prisma.conversation.create({
          data: { ...pair, createdById: viewerId },
          select: conversationSelect,
        });
      } catch (error) {
        if (!uniqueViolation(error)) throw error;
        row = await find();
      }
    }
    if (!row) throw new AuthError('CONVERSATION_NOT_FOUND');
    return toConversation(
      viewerId,
      row,
      await this.shared.resolve(viewerId, row.messages),
    );
  }

  // Most recent activity first. An empty conversation is listed only for
  // the person who opened it, so opening a chat does not notify the peer.
  async list(
    viewerId: string,
    page: PageQuery,
  ): Promise<{ items: Conversation[]; nextCursor: string | null }> {
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.conversation.findMany({
      where: {
        AND: [
          participant(viewerId),
          {
            OR: [
              { createdById: viewerId },
              { messages: { some: {} } },
              { calls: { some: {} } },
            ],
          },
          after
            ? {
                OR: [
                  { lastActivityAt: { lt: after.date } },
                  { lastActivityAt: after.date, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      select: conversationSelect,
    });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    const refs = await this.shared.resolve(
      viewerId,
      items.flatMap((row) => row.messages),
    );
    return {
      items: items.map((row) => toConversation(viewerId, row, refs)),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.lastActivityAt.toISOString(), last.id)
          : null,
    };
  }

  async get(viewerId: string, id: string): Promise<Conversation> {
    const row = await this.database.prisma.conversation.findFirst({
      where: { id, ...participant(viewerId) },
      select: conversationSelect,
    });
    if (!row) throw new AuthError('CONVERSATION_NOT_FOUND');
    return toConversation(
      viewerId,
      row,
      await this.shared.resolve(viewerId, row.messages),
    );
  }

  private async requireParticipant(viewerId: string, id: string) {
    const found = await this.database.prisma.conversation.findFirst({
      where: { id, ...participant(viewerId) },
      select: { userAId: true, userBId: true },
    });
    if (!found) throw new AuthError('CONVERSATION_NOT_FOUND');
    return found;
  }

  // Newest first (createdAt DESC, id DESC); nextCursor reads older pages.
  async messages(
    viewerId: string,
    id: string,
    page: PageQuery,
  ): Promise<{ items: DirectMessage[]; nextCursor: string | null }> {
    await this.requireParticipant(viewerId, id);
    const before = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.directMessage.findMany({
      where: {
        conversationId: id,
        ...(before && {
          OR: [
            { createdAt: { lt: before.date } },
            { createdAt: before.date, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      select: messageSelect,
    });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    const refs = await this.shared.resolve(viewerId, items);
    return {
      items: items.map((row) => toMessage(row, refs.get(row.id))),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    };
  }

  // The message and the conversation's activity are saved in one
  // transaction. A retry with the same clientMessageId returns the stored
  // message; the same id with other content is MESSAGE_ID_CONFLICT.
  async send(
    viewerId: string,
    id: string,
    input: SendMessageRequest,
  ): Promise<DirectMessage> {
    const pair = await this.requireParticipant(viewerId, id);
    const replay = () => this.replay(viewerId, id, input);
    const previous = await replay();
    if (previous) return previous;
    try {
      const row = await this.database.prisma.$transaction(async (tx) => {
        const message = await tx.directMessage.create({
          data: {
            conversationId: id,
            senderId: viewerId,
            clientMessageId: input.clientMessageId,
            text: input.text,
          },
          select: messageSelect,
        });
        // Never moves backwards when two sends commit out of order.
        await tx.conversation.updateMany({
          where: { id, lastActivityAt: { lt: message.createdAt } },
          data: { lastActivityAt: message.createdAt },
        });
        return message;
      });
      // After commit, to both participants (the sender's other tabs too).
      // A replayed retry was already announced.
      this.events.notify([pair.userAId, pair.userBId], {
        conversationId: id,
        messageId: row.id,
      });
      return toMessage(row);
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
      const stored = await replay();
      if (!stored) throw error;
      return stored;
    }
  }

  async sendMedia(
    viewerId: string,
    id: string,
    input: { clientMessageId: string; text: string },
    bytes: Buffer,
    type: 'image' | 'voice',
  ): Promise<DirectMessage> {
    const pair = await this.requireParticipant(viewerId, id);
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const replay = async () => {
      const row = await this.database.prisma.directMessage.findUnique({
        where: {
          senderId_clientMessageId: {
            senderId: viewerId,
            clientMessageId: input.clientMessageId,
          },
        },
        select: messageSelect,
      });
      if (!row) return undefined;
      if (
        row.conversationId !== id ||
        row.text !== input.text ||
        row.sourceHash !== sourceHash ||
        (row.media?.type === 'AUDIO' ? 'voice' : 'image') !== type
      )
        throw new AuthError('MESSAGE_ID_CONFLICT');
      return toMessage(row);
    };
    const previous = await replay();
    if (previous) return previous;
    const stored =
      type === 'voice'
        ? await this.media.storeVoice(viewerId, bytes)
        : await this.media.store(viewerId, 'DIRECT', bytes);
    let row: MessageRow;
    try {
      row = await this.database.prisma.$transaction(async (tx) => {
        await this.media.activate(tx, stored);
        const message = await tx.directMessage.create({
          data: {
            conversationId: id,
            senderId: viewerId,
            clientMessageId: input.clientMessageId,
            text: input.text,
            sourceHash,
            mediaId: stored.id,
          },
          select: messageSelect,
        });
        await tx.conversation.updateMany({
          where: { id, lastActivityAt: { lt: message.createdAt } },
          data: { lastActivityAt: message.createdAt },
        });
        return message;
      });
    } catch (error) {
      await this.media.discard(stored.id);
      if (uniqueViolation(error)) {
        const previous = await replay();
        if (previous) return previous;
      }
      throw error;
    }
    // A notification or serialization failure after commit must never discard
    // the durable attachment. Retrying still returns the stored message.
    this.events.notify([pair.userAId, pair.userBId], {
      conversationId: id,
      messageId: row.id,
    });
    return toMessage(row);
  }

  async share(viewerId: string, id: string, raw: ShareContentRequest) {
    id = id.toLowerCase();
    const input = { ...raw, contentId: raw.contentId.toLowerCase() };
    const pair = await this.requireParticipant(viewerId, id);
    const replay = async () => {
      const row = await this.database.prisma.directMessage.findUnique({
        where: {
          senderId_clientMessageId: {
            senderId: viewerId,
            clientMessageId: input.clientMessageId,
          },
        },
        select: messageSelect,
      });
      if (!row) return undefined;
      if (
        row.conversationId !== id ||
        row.text !== input.text ||
        row.sharedKind !== sharedKind[input.kind] ||
        row.sharedTargetId !== input.contentId
      )
        throw new AuthError('MESSAGE_ID_CONFLICT');
      const refs = await this.shared.resolve(viewerId, [row]);
      return {
        message: toMessage(row, refs.get(row.id)),
        shareCount:
          refs.get(row.id)?.status === 'available'
            ? await this.shared.count(input)
            : null,
      };
    };
    const previous = await replay();
    if (previous) return previous;
    let row: MessageRow;
    let shareCount: number;
    try {
      const result = await this.database.prisma.$transaction(async (tx) => {
        await this.shared.requireVisible(tx, viewerId, input);
        const message = await tx.directMessage.create({
          data: {
            conversationId: id,
            senderId: viewerId,
            clientMessageId: input.clientMessageId,
            text: input.text,
            sharedKind: sharedKind[input.kind],
            sharedTargetId: input.contentId,
            ...(input.kind === 'story'
              ? { sharedStoryId: input.contentId }
              : { sharedPostId: input.contentId }),
          },
          select: messageSelect,
        });
        const shareCount = await this.shared.record(tx, viewerId, input);
        await tx.conversation.updateMany({
          where: { id, lastActivityAt: { lt: message.createdAt } },
          data: { lastActivityAt: message.createdAt },
        });
        return { message, shareCount };
      });
      row = result.message;
      shareCount = result.shareCount;
    } catch (error) {
      if (uniqueViolation(error)) {
        const result = await replay();
        if (result) return result;
      }
      throw error;
    }
    this.events.notify([pair.userAId, pair.userBId], {
      conversationId: id,
      messageId: row.id,
    });
    const refs = await this.shared.resolve(viewerId, [row]);
    return {
      message: toMessage(row, refs.get(row.id)),
      shareCount: refs.get(row.id)?.status === 'available' ? shareCount : null,
    };
  }

  // Direct owns its participant policy; MediaModule only opens private bytes.
  async attachment(
    viewerId: string,
    id: string,
    messageId: string,
    variant: 'full' | 'thumb' | 'audio' | 'opus',
  ) {
    await this.requireParticipant(viewerId, id);
    const row = await this.database.prisma.directMessage.findFirst({
      where: {
        id: messageId,
        conversationId: id,
        media: {
          kind: 'DIRECT',
          state: 'READY',
          type: variant === 'audio' || variant === 'opus' ? 'AUDIO' : 'IMAGE',
        },
      },
      select: { mediaId: true },
    });
    if (!row?.mediaId) throw new AuthError('MEDIA_NOT_FOUND');
    const file = await this.media.open(row.mediaId, variant);
    if (!file) throw new AuthError('MEDIA_NOT_FOUND');
    return file;
  }

  private async replay(
    viewerId: string,
    id: string,
    input: SendMessageRequest,
  ): Promise<DirectMessage | undefined> {
    const stored = await this.database.prisma.directMessage.findUnique({
      where: {
        senderId_clientMessageId: {
          senderId: viewerId,
          clientMessageId: input.clientMessageId,
        },
      },
      select: messageSelect,
    });
    if (!stored) return undefined;
    if (
      stored.conversationId !== id ||
      stored.text !== input.text ||
      stored.sourceHash !== null ||
      stored.sharedKind !== null
    )
      throw new AuthError('MESSAGE_ID_CONFLICT');
    return toMessage(stored);
  }
}
