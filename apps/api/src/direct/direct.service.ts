import { Inject, Injectable } from '@nestjs/common';
import {
  ConversationSchema,
  DirectMessageSchema,
  type Conversation,
  type DirectMessage,
  type PageQuery,
  type SendMessageRequest,
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
import { DirectEvents } from './direct-events.js';

const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  clientMessageId: true,
  text: true,
  createdAt: true,
} as const;

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  text: string;
  createdAt: Date;
};

const conversationSelect = {
  id: true,
  userAId: true,
  lastActivityAt: true,
  userA: { select: summarySelect },
  userB: { select: summarySelect },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: messageSelect,
  },
} as const satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{
  select: typeof conversationSelect;
}>;

function toMessage(row: MessageRow): DirectMessage {
  return DirectMessageSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

function toConversation(viewerId: string, row: ConversationRow): Conversation {
  const last = row.messages[0];
  return ConversationSchema.parse({
    id: row.id,
    peer: userSummary(row.userAId === viewerId ? row.userB : row.userA),
    lastMessage: last ? toMessage(last) : null,
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
    @Inject(DirectEvents) private readonly events: DirectEvents,
  ) {}

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
    return toConversation(viewerId, row);
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
          { OR: [{ createdById: viewerId }, { messages: { some: {} } }] },
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
    return {
      items: items.map((row) => toConversation(viewerId, row)),
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
    return toConversation(viewerId, row);
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
    return {
      items: items.map(toMessage),
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
    if (stored.conversationId !== id || stored.text !== input.text)
      throw new AuthError('MESSAGE_ID_CONFLICT');
    return toMessage(stored);
  }
}
