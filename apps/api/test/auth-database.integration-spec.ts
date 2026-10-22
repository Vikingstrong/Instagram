import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/infrastructure/database/database.client.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import type { Prisma } from '../src/generated/prisma/client.js';

// Fails on missing/overlapping configuration. Never uses the dev database.
const client = createDatabaseClient(readDatabaseUrl(process.env, 'test'));
const ownedUsers: string[] = [];
const createdAt = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-02T00:00:00.000Z');
const actionAt = new Date('2026-01-01T12:00:00.000Z');
const hash = () => randomBytes(32).toString('hex');

function user(overrides: Partial<Prisma.UserCreateInput> = {}) {
  const id = randomUUID();
  ownedUsers.push(id);
  const username = `u_${id.replaceAll('-', '').slice(0, 20)}`;
  const email = `${id}@example.test`;
  return client.user.create({
    data: {
      id,
      email,
      emailKey: email.toLowerCase(),
      username,
      usernameKey: username.toLowerCase(),
      passwordHash: '$synthetic-test-hash$not-a-real-credential',
      ...overrides,
    },
  });
}

describe('Auth persistence (real PostgreSQL migrations)', () => {
  beforeAll(async () => client.$connect());
  afterAll(async () => {
    try {
      // Delete only UUIDs owned by this run; FK cascades clean its children.
      await client.user.deleteMany({ where: { id: { in: ownedUsers } } });
    } finally {
      await client.$disconnect();
    }
  });

  it('creates an unverified user and stores only opaque-token hashes', async () => {
    const account = await user();
    expect(account.emailVerifiedAt).toBeNull();
    expect(account.credentialVersion).toBe(0);
    const session = await client.authSession.create({
      data: {
        userId: account.id,
        tokenHash: hash(),
        credentialVersion: 0,
        createdAt,
        expiresAt,
      },
    });
    const token = await client.authToken.create({
      data: {
        userId: account.id,
        tokenHash: hash(),
        credentialVersion: 0,
        purpose: 'EMAIL_VERIFICATION',
        createdAt,
        expiresAt,
      },
    });
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(token.consumedAt).toBeNull();
    const columns = await client.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('auth_sessions', 'auth_tokens')
    `;
    expect(columns.some((row) => row.column_name === 'tokenHash')).toBe(true);
    expect(
      columns.some((row) =>
        ['token', 'rawToken', 'password'].includes(row.column_name),
      ),
    ).toBe(false);
  });

  it.each(['email', 'username'] as const)(
    'rejects concurrent case variants of the same %s',
    async (field) => {
      const value =
        field === 'email'
          ? `${randomUUID()}@example.test`
          : `u_${randomBytes(8).toString('hex')}`;
      const key = field === 'email' ? 'emailKey' : 'usernameKey';
      const results = await Promise.allSettled([
        user({ [field]: value, [key]: value.toLowerCase() }),
        user({ [field]: value.toUpperCase(), [key]: value.toLowerCase() }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
        code: 'P2002',
      });
    },
  );

  it('rejects forged identity keys and invalid username values at the database boundary', async () => {
    await expect(
      user({ emailKey: `${randomUUID()}@different.test` }),
    ).rejects.toThrow();
    await expect(user({ usernameKey: 'different_key' })).rejects.toThrow();
    for (const username of [
      'ab',
      'a'.repeat(31),
      'имя',
      'abc\n',
      'has space',
    ]) {
      await expect(
        user({ username, usernameKey: username.toLowerCase() }),
      ).rejects.toThrow();
    }
    await expect(user({ passwordHash: '' })).rejects.toThrow();
    await expect(user({ passwordHash: 'x'.repeat(1025) })).rejects.toThrow();
    await expect(user({ credentialVersion: -1 })).rejects.toThrow();
  });

  it('enforces unique hashes, valid lifetimes, versions and foreign keys on sessions', async () => {
    const account = await user();
    const data = {
      userId: account.id,
      tokenHash: hash(),
      credentialVersion: 0,
      createdAt,
      expiresAt,
    };
    await client.authSession.create({ data });
    await expect(client.authSession.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(
      client.authSession.create({
        data: { ...data, tokenHash: hash(), userId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    for (const override of [
      { tokenHash: 'plaintext-token' },
      { tokenHash: 'G'.repeat(64) },
      { expiresAt: createdAt },
      { revokedAt: new Date('2025-01-01') },
      { credentialVersion: -1 },
    ]) {
      await expect(
        client.authSession.create({
          data: { ...data, tokenHash: hash(), ...override },
        }),
      ).rejects.toThrow();
    }
  });

  it('enforces token purpose, unique hashes and legal lifecycle timestamps', async () => {
    const account = await user();
    const data = {
      userId: account.id,
      tokenHash: hash(),
      credentialVersion: 0,
      purpose: 'PASSWORD_RESET' as const,
      createdAt,
      expiresAt,
    };
    await client.authToken.create({ data });
    await expect(
      client.authToken.create({
        data: { ...data, purpose: 'EMAIL_VERIFICATION' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      client.authToken.create({
        data: { ...data, tokenHash: hash(), userId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    for (const override of [
      { tokenHash: 'plaintext-token' },
      { expiresAt: createdAt },
      { credentialVersion: -1 },
      { consumedAt: expiresAt },
      { consumedAt: new Date('2025-01-01') },
      { consumedAt: actionAt, revokedAt: actionAt },
    ]) {
      await expect(
        client.authToken.create({
          data: { ...data, tokenHash: hash(), ...override },
        }),
      ).rejects.toThrow();
    }
    await expect(client.$executeRaw`
      UPDATE auth_tokens SET purpose = 'UNSUPPORTED' WHERE "userId" = ${account.id}::uuid
    `).rejects.toThrow();
  });

  it('supports conditional one-time consumption with exactly one concurrent winner', async () => {
    const account = await user();
    const token = await client.authToken.create({
      data: {
        userId: account.id,
        tokenHash: hash(),
        credentialVersion: 0,
        purpose: 'PASSWORD_RESET',
        createdAt,
        expiresAt,
      },
    });
    const where = {
      id: token.id,
      purpose: 'PASSWORD_RESET' as const,
      credentialVersion: 0,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: actionAt },
    };
    const results = await Promise.all([
      client.authToken.updateMany({ where, data: { consumedAt: actionAt } }),
      client.authToken.updateMany({ where, data: { consumedAt: actionAt } }),
    ]);
    expect(results.map((result) => result.count).sort((a, b) => a - b)).toEqual(
      [0, 1],
    );
  });

  it('does not consume a token of the wrong purpose, expired, revoked, or stale version', async () => {
    const account = await user();
    const token = await client.authToken.create({
      data: {
        userId: account.id,
        tokenHash: hash(),
        credentialVersion: 0,
        purpose: 'PASSWORD_RESET',
        createdAt,
        expiresAt,
      },
    });
    const base = {
      id: token.id,
      purpose: 'PASSWORD_RESET' as const,
      credentialVersion: 0,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: actionAt },
    };
    for (const where of [
      { ...base, purpose: 'EMAIL_VERIFICATION' as const },
      { ...base, expiresAt: { gt: expiresAt } },
      { ...base, credentialVersion: 1 },
    ]) {
      expect(
        (
          await client.authToken.updateMany({
            where,
            data: { consumedAt: actionAt },
          })
        ).count,
      ).toBe(0);
    }
    await client.authToken.update({
      where: { id: token.id },
      data: { revokedAt: actionAt },
    });
    expect(
      (
        await client.authToken.updateMany({
          where: base,
          data: { consumedAt: actionAt },
        })
      ).count,
    ).toBe(0);
  });

  it('commits password/version and revocations together, or rolls all changes back', async () => {
    const account = await user();
    const session = await client.authSession.create({
      data: {
        userId: account.id,
        tokenHash: hash(),
        credentialVersion: 0,
        createdAt,
        expiresAt,
      },
    });
    const token = await client.authToken.create({
      data: {
        userId: account.id,
        tokenHash: hash(),
        credentialVersion: 0,
        purpose: 'PASSWORD_RESET',
        createdAt,
        expiresAt,
      },
    });
    await expect(
      client.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: account.id },
          data: {
            passwordHash: '$synthetic$new-hash',
            credentialVersion: { increment: 1 },
          },
        });
        await tx.authSession.updateMany({
          where: { userId: account.id },
          data: { revokedAt: actionAt },
        });
        await tx.authToken.updateMany({
          where: { userId: account.id, consumedAt: null },
          data: { revokedAt: actionAt },
        });
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');
    expect(
      await client.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({
      passwordHash: account.passwordHash,
      credentialVersion: 0,
    });
    expect(
      (
        await client.authSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).revokedAt,
    ).toBeNull();
    expect(
      (await client.authToken.findUniqueOrThrow({ where: { id: token.id } }))
        .revokedAt,
    ).toBeNull();
    await client.$transaction([
      client.user.update({
        where: { id: account.id },
        data: {
          passwordHash: '$synthetic$new-hash',
          credentialVersion: { increment: 1 },
        },
      }),
      client.authSession.updateMany({
        where: { userId: account.id },
        data: { revokedAt: actionAt },
      }),
      client.authToken.updateMany({
        where: { userId: account.id, consumedAt: null },
        data: { revokedAt: actionAt },
      }),
    ]);
    expect(
      await client.user.findUniqueOrThrow({ where: { id: account.id } }),
    ).toMatchObject({
      passwordHash: '$synthetic$new-hash',
      credentialVersion: 1,
    });
    expect(
      (
        await client.authSession.findUniqueOrThrow({
          where: { id: session.id },
        })
      ).revokedAt,
    ).toEqual(actionAt);
    expect(
      (await client.authToken.findUniqueOrThrow({ where: { id: token.id } }))
        .revokedAt,
    ).toEqual(actionAt);
  });

  it('cascades children only for the deleted user', async () => {
    const account = await user();
    const other = await user();
    for (const userId of [account.id, other.id]) {
      await client.authSession.create({
        data: {
          userId,
          tokenHash: hash(),
          credentialVersion: 0,
          createdAt,
          expiresAt,
        },
      });
      await client.authToken.create({
        data: {
          userId,
          tokenHash: hash(),
          credentialVersion: 0,
          purpose: 'EMAIL_VERIFICATION',
          createdAt,
          expiresAt,
        },
      });
    }
    await client.user.delete({ where: { id: account.id } });
    expect(
      await client.authSession.count({ where: { userId: account.id } }),
    ).toBe(0);
    expect(
      await client.authToken.count({ where: { userId: account.id } }),
    ).toBe(0);
    expect(
      await client.authSession.count({ where: { userId: other.id } }),
    ).toBe(1);
    expect(await client.authToken.count({ where: { userId: other.id } })).toBe(
      1,
    );
  });
});
