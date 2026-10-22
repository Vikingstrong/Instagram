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
  ) {}
  async register(input: AuthRegisterRequest): Promise<AuthUser> {
    const passwordHash = await this.hasher.hash(input.password);
    try {
      const account = await this.database.prisma.user.create({
        data: {
          email: input.email,
          emailKey: input.email.toLowerCase(),
          username: input.username,
          usernameKey: input.username.toLowerCase(),
          passwordHash,
        },
        select: publicSelect,
      });
      return publicUser(account);
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
    await this.database.prisma.authSession.updateMany({
      where: { tokenHash: sessionHash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
