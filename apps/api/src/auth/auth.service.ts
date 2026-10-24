import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  AuthUserSchema,
  type AuthLoginRequest,
  type AuthRegisterRequest,
  type AuthUser,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';
import { AuthError } from './auth.error.js';
import { MailService } from '../mail/mail.service.js';
import { AUTH_CONFIG, type AuthConfiguration } from './auth.config.js';
import { SessionRevocations } from './session-revocations.js';

export const SESSION_TTL_MS = 7 * 24 * 3600_000;
const sessionPattern = /^[A-Za-z0-9_-]{43}$/;
export const sessionHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
const publicSelect = {
  id: true,
  email: true,
  username: true,
  emailVerifiedAt: true,
} as const;
function publicUser(user: {
  id: string;
  email: string;
  username: string;
  emailVerifiedAt: Date | null;
}): AuthUser {
  return AuthUserSchema.parse({
    id: user.id,
    email: user.email,
    username: user.username,
    emailVerified: user.emailVerifiedAt !== null,
  });
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfiguration,
    @Inject(SessionRevocations)
    private readonly revocations: SessionRevocations,
  ) {}
  // Registration signs the new account in atomically: the session is created in
  // the same transaction as the account. Email ownership is not verified.
  async register(
    input: AuthRegisterRequest,
  ): Promise<{ user: AuthUser; token: string }> {
    const passwordHash = await this.hasher.hash(input.password);
    const token = randomBytes(32).toString('base64url');
    try {
      const account = await this.database.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: input.email,
            emailKey: input.email.toLowerCase(),
            username: input.username,
            usernameKey: input.username.toLowerCase(),
            passwordHash,
          },
          select: { ...publicSelect, credentialVersion: true },
        });
        await tx.authSession.create({
          data: {
            userId: created.id,
            tokenHash: sessionHash(token),
            credentialVersion: created.credentialVersion,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          },
        });
        return created;
      });
      return { user: publicUser(account), token };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new AuthError('ACCOUNT_UNAVAILABLE');
      throw error;
    }
  }

  async login(
    input: AuthLoginRequest,
  ): Promise<{ user: AuthUser; token: string }> {
    const account = await this.database.prisma.user.findUnique({
      where: { emailKey: input.email.toLowerCase() },
      select: { ...publicSelect, passwordHash: true, credentialVersion: true },
    });
    const matches = await this.hasher.verify(
      input.password,
      account?.passwordHash,
    );
    if (!account || !matches) throw new AuthError('INVALID_CREDENTIALS');
    const token = randomBytes(32).toString('base64url');
    // Re-read under a row lock after the expensive hash check. Future resets
    // must lock this same user row: no session may escape with an old version.
    const user = await this.database.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { credentialVersion: number; passwordHash: string }[]
      >`SELECT "credentialVersion", "passwordHash" FROM auth_users WHERE id = ${account.id}::uuid FOR UPDATE`;
      if (
        rows[0]?.credentialVersion !== account.credentialVersion ||
        rows[0]?.passwordHash !== account.passwordHash
      )
        throw new AuthError('INVALID_CREDENTIALS');
      await tx.authSession.create({
        data: {
          userId: account.id,
          tokenHash: sessionHash(token),
          credentialVersion: account.credentialVersion,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
      return publicUser(
        await tx.user.findUniqueOrThrow({
          where: { id: account.id },
          select: publicSelect,
        }),
      );
    });
    return { user, token };
  }

  async session(token: string | undefined): Promise<AuthUser | null> {
    if (!token || !sessionPattern.test(token)) return null;
    const session = await this.database.prisma.authSession.findUnique({
      where: { tokenHash: sessionHash(token) },
      select: {
        revokedAt: true,
        expiresAt: true,
        credentialVersion: true,
        user: { select: { ...publicSelect, credentialVersion: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.credentialVersion !== session.user.credentialVersion
    )
      return null;
    return publicUser(session.user);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !sessionPattern.test(token)) return;
    const tokenHash = sessionHash(token);
    await this.database.prisma.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.revocations.publish({ tokenHash });
  }

  private async issueToken(
    tx: Prisma.TransactionClient,
    userId: string,
    version: number,
    purpose: 'PASSWORD_RESET',
  ): Promise<void> {
    const now = new Date();
    // The caller holds the user lock (or just created the row). Serialize quota,
    // token replacement, reset and login against that same row.
    const recent = await tx.authToken.findMany({
      where: { userId, purpose, createdAt: { gt: new Date(now.getTime() - 3600_000) } },
      select: { createdAt: true },
    });
    if (
      recent.length >= 3 ||
      recent.some((t) => t.createdAt.getTime() > now.getTime() - 60_000)
    )
      return;
    await this.mail.cancel(tx, userId, purpose);
    await tx.authToken.updateMany({
      where: { userId, purpose, consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const raw = randomBytes(32).toString('base64url');
    const token = await tx.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sessionHash(raw),
        credentialVersion: version,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      },
    });
    const path = 'reset-password';
    // Fragment tokens do not enter HTTP URLs/access logs or referrer headers.
    await this.mail.enqueue(
      tx,
      token.id,
      `${this.config.publicOrigin}/auth/${path}#token=${raw}`,
    );
  }

  async requestEmail(email: string, purpose: 'PASSWORD_RESET'): Promise<void> {
    this.mail.assertAvailable();
    await this.database.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          credentialVersion: number;
        }[]
      >`
        SELECT id, "credentialVersion" FROM auth_users
        WHERE "emailKey" = ${email.toLowerCase()} FOR UPDATE`;
      const account = rows[0];
      if (!account) return;
      await this.issueToken(tx, account.id, account.credentialVersion, purpose);
    });
  }

  private async consume(
    raw: string,
    purpose: 'PASSWORD_RESET',
    passwordHash?: string,
  ): Promise<void> {
    const hash = sessionHash(raw);
    const hint = await this.database.prisma.authToken.findUnique({
      where: { tokenHash: hash },
      select: { userId: true },
    });
    if (!hint) throw new AuthError('INVALID_OR_EXPIRED_TOKEN');
    const revokedSessions = await this.database.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ credentialVersion: number }[]>`
        SELECT "credentialVersion" FROM auth_users WHERE id = ${hint.userId}::uuid FOR UPDATE`;
        const token = await tx.authToken.findUnique({
          where: { tokenHash: hash },
        });
        const now = new Date();
        if (
          !rows[0] ||
          !token ||
          token.purpose !== purpose ||
          token.consumedAt ||
          token.revokedAt ||
          token.expiresAt <= now ||
          token.credentialVersion !== rows[0].credentialVersion
        )
          throw new AuthError('INVALID_OR_EXPIRED_TOKEN');
        await tx.authToken.update({
          where: { id: token.id },
          data: { consumedAt: now },
        });
        if (!passwordHash) throw new AuthError('INVALID_REQUEST');
        await tx.user.update({
          where: { id: token.userId },
          data: { passwordHash, credentialVersion: { increment: 1 } },
        });
        await tx.authSession.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.authToken.updateMany({
          where: { userId: token.userId, consumedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.mail.cancel(tx, token.userId);
        return true;
      },
    );
    // A password reset signs out everywhere, including open streams.
    if (revokedSessions) this.revocations.publish({ userId: hint.userId });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    // Hash outside the transaction/row lock. consume rechecks expiry/version
    // after acquiring the lock, so concurrent reset/login cannot escape.
    const passwordHash = await this.hasher.hash(password);
    await this.consume(token, 'PASSWORD_RESET', passwordHash);
  }
}
