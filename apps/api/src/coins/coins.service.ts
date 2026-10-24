import { Inject, Injectable } from '@nestjs/common';
import {
  CoinGiftReceiptSchema,
  CoinTransactionSchema,
  CoinWalletSchema,
  coinRules,
  type CoinGiftReceipt,
  type PageQuery,
} from '@instagram/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { AuthError } from '../auth/auth.error.js';
import {
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from '../users/user-summary.js';
import { COINS_CLOCK, MAX_COIN_BALANCE, coinWindow } from './coin-clock.js';

const selection = {
  id: true,
  kind: true,
  senderId: true,
  recipientId: true,
  amount: true,
  senderBalanceAfter: true,
  recipientBalanceAfter: true,
  streamId: true,
  giftKey: true,
  idempotencyKey: true,
  createdAt: true,
  sender: { select: summarySelect },
  recipient: { select: summarySelect },
} as const;
type Operation = Prisma.CoinOperationGetPayload<{ select: typeof selection }>;

function transactionDto(row: Operation, viewerId: string) {
  const sent = row.senderId === viewerId;
  return CoinTransactionSchema.parse({
    id: row.id,
    kind:
      row.kind === 'DAILY_REWARD'
        ? 'daily_reward'
        : sent
          ? 'gift_sent'
          : 'gift_received',
    amount: row.amount.toString(),
    balanceAfter: (sent
      ? row.senderBalanceAfter!
      : row.recipientBalanceAfter
    ).toString(),
    createdAt: row.createdAt.toISOString(),
    counterparty:
      row.kind === 'DAILY_REWARD'
        ? null
        : userSummary(sent ? row.recipient : row.sender!),
    gift:
      row.kind === 'DAILY_REWARD'
        ? null
        : { streamId: row.streamId, giftKey: row.giftKey },
  });
}

// Trusted module-to-module command, NEVER an HTTP request body. Live resolves
// recipient and price from its own locked stream/catalog before calling this.
export type GiftTransferCommand = {
  senderId: string;
  recipientId: string;
  amount: string;
  streamId: string;
  giftKey: string;
  idempotencyKey: string;
};
@Injectable()
export class CoinsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(COINS_CLOCK) private readonly clock: () => Date,
  ) {}

  private async snapshot(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ) {
    const window = coinWindow(now);
    const wallet = await tx.coinWallet.findUnique({ where: { userId } });
    const claim = await tx.coinOperation.findUnique({
      where: {
        recipientId_claimDate: {
          recipientId: userId,
          claimDate: window.claimDate,
        },
      },
      select: { id: true },
    });
    return CoinWalletSchema.parse({
      balance: (wallet?.balance ?? 0n).toString(),
      serverTime: now.toISOString(),
      dailyReward: {
        amount: coinRules.dailyAmount,
        timeZone: coinRules.timeZone,
        claimed: !!claim,
        nextClaimAt: window.nextClaimAt,
      },
    });
  }
  wallet(userId: string) {
    // The balance and daily flag must describe the same committed snapshot.
    return this.db.prisma.$transaction(
      (tx) => this.snapshot(tx, userId, this.clock()),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async lockWallets(tx: Prisma.TransactionClient, userIds: string[]) {
    const balances = new Map<string, bigint>();
    // Same order for all transfers, including opposite-direction transfers.
    for (const id of [...new Set(userIds)].sort()) {
      await tx.$executeRaw`INSERT INTO "coin_wallets" ("userId") VALUES (${id}::uuid) ON CONFLICT ("userId") DO NOTHING`;
      const rows = await tx.$queryRaw<
        { balance: bigint }[]
      >`SELECT "balance" FROM "coin_wallets" WHERE "userId" = ${id}::uuid FOR UPDATE`;
      balances.set(id, rows[0]!.balance);
    }
    return balances;
  }

  claim(userId: string) {
    return this.db.prisma.$transaction(async (tx) => {
      const balances = await this.lockWallets(tx, [userId]);
      const now = this.clock();
      const { claimDate } = coinWindow(now);
      const existing = await tx.coinOperation.findUnique({
        where: { recipientId_claimDate: { recipientId: userId, claimDate } },
        select: selection,
      });
      if (existing)
        return {
          credited: false,
          wallet: await this.snapshot(tx, userId, now),
          transaction: transactionDto(existing, userId),
        };
      const balance = balances.get(userId)! + BigInt(coinRules.dailyAmount);
      if (balance > MAX_COIN_BALANCE)
        throw new AuthError('COINS_BALANCE_LIMIT');
      await tx.coinWallet.update({ where: { userId }, data: { balance } });
      const operation = await tx.coinOperation.create({
        data: {
          kind: 'DAILY_REWARD',
          recipientId: userId,
          amount: BigInt(coinRules.dailyAmount),
          recipientBalanceAfter: balance,
          claimDate,
          createdAt: now,
        },
        select: selection,
      });
      return {
        credited: true,
        wallet: await this.snapshot(tx, userId, now),
        transaction: transactionDto(operation, userId),
      };
    });
  }

  async transactions(userId: string, page: PageQuery) {
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.db.prisma.coinOperation.findMany({
      where: {
        AND: [
          { OR: [{ senderId: userId }, { recipientId: userId }] },
          after
            ? {
                OR: [
                  { createdAt: { lt: after.date } },
                  { createdAt: after.date, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      select: selection,
    });
    const more = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => transactionDto(row, userId)),
      nextCursor:
        more && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    };
  }

  /** Call inside the SAME transaction as Live authorization, lifecycle check
   * and gift persistence. Exceptions must escape that transaction and roll it
   * back. No route exposes this method before Live implements those checks. */
  async transferGift(
    tx: Prisma.TransactionClient,
    input: GiftTransferCommand,
  ): Promise<{ receipt: CoinGiftReceipt; replayed: boolean }> {
    // PrismaClient structurally satisfies TransactionClient in TypeScript.
    // Refuse that accidental use: interactive clients remove $connect.
    // Prisma 7.10 supports nested $transaction, so that method is not a marker.
    if ('$connect' in tx) throw new AuthError('INVALID_REQUEST');
    // Reuse the wire schema for UUID/string validation, not for authorization.
    // input also contains idempotencyKey, deliberately parsed separately.
    const { idempotencyKey, ...fields } = input;
    const values = CoinGiftReceiptSchema.omit({
      id: true,
      createdAt: true,
    }).safeParse(fields);
    const key =
      CoinGiftReceiptSchema.shape.id.safeParse(idempotencyKey).success;
    if (
      !values.success ||
      !key ||
      input.amount === '0' ||
      input.senderId === input.recipientId
    )
      throw new AuthError('INVALID_REQUEST');
    input = {
      ...input,
      senderId: input.senderId.toLowerCase(),
      recipientId: input.recipientId.toLowerCase(),
      streamId: input.streamId.toLowerCase(),
    };
    if (input.senderId === input.recipientId)
      throw new AuthError('INVALID_REQUEST');
    const balances = await this.lockWallets(tx, [
      input.senderId,
      input.recipientId,
    ]);
    const existing = await tx.coinOperation.findUnique({
      where: {
        senderId_idempotencyKey: { senderId: input.senderId, idempotencyKey },
      },
    });
    if (existing) {
      if (
        existing.recipientId !== input.recipientId ||
        existing.amount.toString() !== input.amount ||
        existing.streamId !== input.streamId ||
        existing.giftKey !== input.giftKey
      )
        throw new AuthError('COINS_OPERATION_CONFLICT');
      return { receipt: this.receipt(existing), replayed: true };
    }
    const amount = BigInt(input.amount);
    const senderBalance = balances.get(input.senderId)!;
    const recipientBalance = balances.get(input.recipientId)! + amount;
    if (senderBalance < amount)
      throw new AuthError('COINS_INSUFFICIENT_BALANCE');
    if (recipientBalance > MAX_COIN_BALANCE)
      throw new AuthError('COINS_BALANCE_LIMIT');
    await tx.coinWallet.update({
      where: { userId: input.senderId },
      data: { balance: senderBalance - amount },
    });
    await tx.coinWallet.update({
      where: { userId: input.recipientId },
      data: { balance: recipientBalance },
    });
    const row = await tx.coinOperation.create({
      data: {
        kind: 'GIFT_TRANSFER',
        senderId: input.senderId,
        recipientId: input.recipientId,
        amount,
        senderBalanceAfter: senderBalance - amount,
        recipientBalanceAfter: recipientBalance,
        streamId: input.streamId,
        giftKey: input.giftKey,
        idempotencyKey,
        createdAt: this.clock(),
      },
    });
    return { receipt: this.receipt(row), replayed: false };
  }
  private receipt(row: {
    id: string;
    amount: bigint;
    senderId: string | null;
    recipientId: string;
    streamId: string | null;
    giftKey: string | null;
    createdAt: Date;
  }) {
    return CoinGiftReceiptSchema.parse({
      id: row.id,
      amount: row.amount.toString(),
      senderId: row.senderId,
      recipientId: row.recipientId,
      streamId: row.streamId,
      giftKey: row.giftKey,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
