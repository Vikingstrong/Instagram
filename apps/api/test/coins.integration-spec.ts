import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID } from 'node:crypto';
import {
  CoinClaimResponseSchema,
  CoinTransactionsResponseSchema,
  CoinWalletResponseSchema,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { AUTH_CONFIG, readAuthConfiguration } from '../src/auth/auth.config.js';
import { AuthRateLimiter } from '../src/auth/auth-rate-limiter.js';
import {
  CoinsService,
  type GiftTransferCommand,
} from '../src/coins/coins.service.js';
import { COINS_CLOCK, MAX_COIN_BALANCE } from '../src/coins/coin-clock.js';

const origin = 'http://localhost:3000';
type Account = {
  client: ReturnType<typeof request.agent>;
  id: string;
  csrf: string;
};
describe('FR-14 Coins: real PostgreSQL locking, calendar claims and gift transfers', () => {
  let app: INestApplication<App>, db: DatabaseService, coins: CoinsService;
  let a: Account, b: Account, c: Account, unverified: Account;
  let now = new Date('2026-10-24T10:00:00Z');
  const ids: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useFactory({
        factory: () =>
          new DatabaseService(readDatabaseUrl(process.env, 'test')),
      })
      .overrideProvider(AUTH_CONFIG)
      .useValue(readAuthConfiguration({ NODE_ENV: 'test' }))
      .overrideProvider(AuthRateLimiter)
      .useValue({ consume: () => undefined })
      .overrideProvider(COINS_CLOCK)
      .useValue(() => new Date(now))
      .compile();
    app = module.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    coins = app.get(CoinsService);
    a = await account();
    b = await account();
    c = await account();
    unverified = await account(false);
  }, 30_000);
  beforeEach(async () => {
    now = new Date('2026-10-24T10:00:00Z');
    await clearCoins();
  });
  afterAll(async () => {
    try {
      await clearCoins();
      await db.prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await app.close();
    }
  });
  async function clearCoins() {
    await db.prisma.coinOperation.deleteMany({
      where: { OR: [{ senderId: { in: ids } }, { recipientId: { in: ids } }] },
    });
    await db.prisma.coinWallet.deleteMany({ where: { userId: { in: ids } } });
  }
  async function account(verified = true): Promise<Account> {
    const client = request.agent(app.getHttpServer());
    const suffix = randomUUID().replaceAll('-', '');
    const csrf = (await client.get('/api/v1/auth/csrf').expect(200)).body
      .csrfToken as string;
    const result = await client
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        email: `coins-${suffix}@example.test`,
        username: `coin_${suffix.slice(0, 18)}`,
        password: 'coins fixture password',
      })
      .expect(201);
    const id = result.body.user.id as string;
    ids.push(id);
    if (verified)
      await db.prisma.user.update({
        where: { id },
        data: { emailVerifiedAt: new Date() },
      });
    return { client, id, csrf };
  }
  const claim = (who: Account, body = {}) =>
    who.client
      .post('/api/v1/coins/daily-claim')
      .set('Origin', origin)
      .set('X-CSRF-Token', who.csrf)
      .send(body);
  async function balance(who: Account) {
    const response = await who.client.get('/api/v1/coins/wallet').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return CoinWalletResponseSchema.parse(response.body).wallet;
  }
  const command = (
    extra: Partial<GiftTransferCommand> = {},
  ): GiftTransferCommand => ({
    senderId: a.id,
    recipientId: b.id,
    amount: '35',
    streamId: randomUUID(),
    giftKey: 'test-gift',
    idempotencyKey: randomUUID(),
    ...extra,
  });
  const transfer = (input: GiftTransferCommand) =>
    db.prisma.$transaction((tx) => coins.transferGift(tx, input), {
      maxWait: 10_000,
      timeout: 10_000,
    });

  it('requires a verified session and never creates or credits a wallet on reads', async () => {
    for (const path of ['/api/v1/coins/wallet', '/api/v1/coins/transactions']) {
      await request(app.getHttpServer()).get(path).expect(401);
      await unverified.client.get(path).expect(403);
    }
    await claim(unverified).expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/coins/daily-claim')
      .send({})
      .expect(401);
    expect((await balance(a)).balance).toBe('0');
    expect((await balance(a)).dailyReward.claimed).toBe(false);
    expect(await db.prisma.coinWallet.count({ where: { userId: a.id } })).toBe(
      0,
    );
    expect(
      await db.prisma.coinOperation.count({ where: { recipientId: a.id } }),
    ).toBe(0);
  });

  it('credits exactly 100 once per account/date, retries return the original operation', async () => {
    const first = await claim(a).expect(200);
    const second = await claim(a).expect(200);
    const one = CoinClaimResponseSchema.parse(first.body),
      two = CoinClaimResponseSchema.parse(second.body);
    expect(one.credited).toBe(true);
    expect(two.credited).toBe(false);
    expect(two.transaction.id).toBe(one.transaction.id);
    expect(two.wallet.balance).toBe('100');
    expect(two.wallet.dailyReward.claimed).toBe(true);
    expect(first.headers['cache-control']).toBe('no-store');
    expect((await balance(b)).balance).toBe('0');
  });

  it('serializes concurrent HTTP claims on a previously absent wallet', async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => claim(a)),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responses.filter((response) => response.body.credited).length).toBe(
      1,
    );
    expect(
      new Set(responses.map((response) => response.body.transaction.id)).size,
    ).toBe(1);
    expect((await balance(a)).balance).toBe('100');
    expect(
      await db.prisma.coinOperation.count({ where: { recipientId: a.id } }),
    ).toBe(1);
  });

  it('resets eligibility at 19:00 UTC / 00:00 Dushanbe, preserving accumulated coins', async () => {
    now = new Date('2026-10-23T18:59:59.999Z');
    await claim(a).expect(200);
    expect((await balance(a)).dailyReward.nextClaimAt).toBe(
      '2026-10-23T19:00:00.000Z',
    );
    now = new Date('2026-10-23T19:00:00.000Z');
    expect((await balance(a)).dailyReward.claimed).toBe(false);
    const response = await claim(a).expect(200);
    expect(response.body.wallet.balance).toBe('200');
    expect(response.body.credited).toBe(true);
    expect(response.body.wallet.dailyReward.nextClaimAt).toBe(
      '2026-10-24T19:00:00.000Z',
    );
    expect(
      (
        await db.prisma.coinOperation.findMany({
          where: { recipientId: a.id },
          orderBy: { claimDate: 'asc' },
        })
      ).map((row) => row.claimDate!.toISOString().slice(0, 10)),
    ).toEqual(['2026-10-23', '2026-10-24']);
  });

  it('evaluates the reward date after a contended wallet lock is acquired', async () => {
    await claim(a).expect(200);
    now = new Date('2026-10-24T18:59:59Z');
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM "coin_wallets" WHERE "userId" = ${a.id}::uuid FOR UPDATE`;
      locked();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await held;
    const pending = coins.claim(a.id);
    try {
      await vi.waitFor(async () => {
        const rows = await db.prisma.$queryRaw<
          { count: number }[]
        >`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND wait_event_type = 'Lock' AND query LIKE '%coin_wallets%'`;
        expect(rows[0]!.count).toBeGreaterThan(0);
      });
      now = new Date('2026-10-24T19:00:00Z');
    } finally {
      release();
    }
    await blocker;
    expect((await pending).credited).toBe(true);
    expect((await balance(a)).balance).toBe('200');
  });

  it('rejects forged rewards, dates, recipients and missing Origin/CSRF', async () => {
    for (const body of [
      { amount: '10000' },
      { userId: b.id },
      { date: '2099-01-01' },
    ])
      await claim(a, body).expect(400);
    await a.client.post('/api/v1/coins/daily-claim').send({}).expect(403);
    await a.client
      .post('/api/v1/coins/daily-claim')
      .set('Origin', 'https://attacker.test')
      .set('X-CSRF-Token', a.csrf)
      .send({})
      .expect(403);
    expect((await balance(a)).balance).toBe('0');
    await a.client
      .post('/api/v1/coins/transfers')
      .set('Origin', origin)
      .set('X-CSRF-Token', a.csrf)
      .send(command())
      .expect(404);
  });

  it('transfers the full gift price to the author and records both private history views', async () => {
    await claim(a).expect(200);
    await claim(b).expect(200);
    const input = command();
    const result = await transfer(input);
    expect(result.replayed).toBe(false);
    expect(result.receipt.amount).toBe('35');
    expect((await balance(a)).balance).toBe('65');
    expect((await balance(b)).balance).toBe('135');
    const historyA = CoinTransactionsResponseSchema.parse(
      (await a.client.get('/api/v1/coins/transactions').expect(200)).body,
    );
    const historyB = CoinTransactionsResponseSchema.parse(
      (await b.client.get('/api/v1/coins/transactions').expect(200)).body,
    );
    const sent = historyA.items.find((row) => row.id === result.receipt.id)!;
    const received = historyB.items.find(
      (row) => row.id === result.receipt.id,
    )!;
    expect(sent.kind).toBe('gift_sent');
    expect(sent.balanceAfter).toBe('65');
    expect(sent.counterparty!.id).toBe(b.id);
    expect(received.kind).toBe('gift_received');
    expect(received.balanceAfter).toBe('135');
    expect(received.counterparty!.id).toBe(a.id);
    expect(
      (await c.client.get('/api/v1/coins/transactions').expect(200)).body.items,
    ).toEqual([]);
  });

  it('replays concurrent identical gift commands without duplicate transfers', async () => {
    await claim(a).expect(200);
    const input = command();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => transfer(input)),
    );
    expect(results.filter((row) => !row.replayed)).toHaveLength(1);
    expect(new Set(results.map((row) => row.receipt.id)).size).toBe(1);
    expect((await balance(a)).balance).toBe('65');
    expect((await balance(b)).balance).toBe('35');
  });

  it('rejects reuse of an operation key with changed recipient, amount or gift context', async () => {
    await claim(a).expect(200);
    const input = command();
    await transfer(input);
    for (const patch of [
      { recipientId: c.id },
      { amount: '36' },
      { streamId: randomUUID() },
      { giftKey: 'different-gift' },
    ]) {
      await expect(transfer({ ...input, ...patch })).rejects.toMatchObject({
        code: 'COINS_OPERATION_CONFLICT',
      });
    }
    expect((await balance(a)).balance).toBe('65');
    expect((await balance(b)).balance).toBe('35');
  });

  it('prevents overdrafts when distinct gifts compete for the same balance', async () => {
    await claim(a).expect(200);
    const result = await Promise.allSettled([
      transfer(command({ amount: '80' })),
      transfer(command({ amount: '80', recipientId: c.id })),
    ]);
    expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(result.find((row) => row.status === 'rejected')).toMatchObject({
      reason: { code: 'COINS_INSUFFICIENT_BALANCE' },
    });
    expect((await balance(a)).balance).toBe('20');
    expect(
      BigInt((await balance(b)).balance) + BigInt((await balance(c)).balance),
    ).toBe(80n);
  });

  it('uses a consistent lock order for simultaneous opposite-direction transfers', async () => {
    await claim(a).expect(200);
    await claim(b).expect(200);
    await Promise.all([
      transfer(command({ amount: '20' })),
      transfer(command({ senderId: b.id, recipientId: a.id, amount: '30' })),
    ]);
    expect((await balance(a)).balance).toBe('110');
    expect((await balance(b)).balance).toBe('90');
  });

  it('rolls back both wallets and the operation if the surrounding Live transaction fails', async () => {
    await claim(a).expect(200);
    const input = command();
    await expect(
      db.prisma.$transaction(async (tx) => {
        await coins.transferGift(tx, input);
        throw new Error('Live transaction failed');
      }),
    ).rejects.toThrow('Live transaction failed');
    expect((await balance(a)).balance).toBe('100');
    expect((await balance(b)).balance).toBe('0');
    expect(
      await db.prisma.coinOperation.count({
        where: { idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(0);
  });

  it('refuses a bare PrismaClient so transfers cannot accidentally run outside a transaction', async () => {
    await claim(a).expect(200);
    await expect(
      coins.transferGift(db.prisma, command()),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect((await balance(a)).balance).toBe('100');
    expect((await balance(b)).balance).toBe('0');
    expect(
      await db.prisma.coinOperation.count({ where: { senderId: a.id } }),
    ).toBe(0);
  });

  it('validates internal commands and refuses unsupported self-gifts', async () => {
    for (const patch of [
      { amount: '0' },
      { amount: '-1' },
      { amount: '1.5' },
      { amount: '10000000000000000000' },
      { recipientId: a.id },
      { idempotencyKey: 'bad' },
    ])
      await expect(transfer(command(patch))).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    expect(
      await db.prisma.coinOperation.count({ where: { senderId: a.id } }),
    ).toBe(0);
  });

  it('preserves bigint precision and rejects balance overflow without partial writes', async () => {
    await db.prisma.coinWallet.create({
      data: { userId: a.id, balance: 9007199254740993n },
    });
    expect((await balance(a)).balance).toBe('9007199254740993');
    await transfer(command({ amount: '1' }));
    expect((await balance(a)).balance).toBe('9007199254740992');
    await db.prisma.coinWallet.update({
      where: { userId: b.id },
      data: { balance: MAX_COIN_BALANCE },
    });
    await expect(transfer(command({ amount: '1' }))).rejects.toMatchObject({
      code: 'COINS_BALANCE_LIMIT',
    });
    expect((await balance(a)).balance).toBe('9007199254740992');
    await db.prisma.coinWallet.update({
      where: { userId: a.id },
      data: { balance: MAX_COIN_BALANCE - 50n },
    });
    const response = await claim(a).expect(409);
    expect(response.body.error.code).toBe('COINS_BALANCE_LIMIT');
    expect(
      await db.prisma.coinOperation.count({
        where: { recipientId: a.id, kind: 'DAILY_REWARD' },
      }),
    ).toBe(0);
  });

  it('paginates equal-timestamp history without repeats and keeps cursors scoped to the viewer', async () => {
    await claim(a).expect(200);
    for (let i = 0; i < 5; i++) await transfer(command({ amount: '1' }));
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const page = CoinTransactionsResponseSchema.parse(
        (
          await a.client
            .get('/api/v1/coins/transactions')
            .query({ limit: 2, ...(cursor ? { cursor } : {}) })
            .expect(200)
        ).body,
      );
      found.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
      if (cursor)
        expect(
          (
            await c.client
              .get('/api/v1/coins/transactions')
              .query({ cursor })
              .expect(200)
          ).body.items,
        ).toEqual([]);
    } while (cursor);
    expect(found).toHaveLength(6);
    expect(new Set(found).size).toBe(6);
    await a.client.get('/api/v1/coins/transactions?cursor=bad').expect(400);
    await a.client.get('/api/v1/coins/transactions?limit=51').expect(400);
  });

  it('enforces nonnegative balances and reward shapes in PostgreSQL', async () => {
    await expect(
      db.prisma.coinWallet.create({ data: { userId: a.id, balance: -1n } }),
    ).rejects.toThrow();
    await expect(
      db.prisma.coinOperation.create({
        data: {
          kind: 'DAILY_REWARD',
          recipientId: a.id,
          amount: 200n,
          recipientBalanceAfter: 200n,
          claimDate: now,
        },
      }),
    ).rejects.toThrow();
  });
});
