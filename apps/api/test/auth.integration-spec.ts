import {
  Controller,
  Get,
  Header,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { randomUUID, createHmac } from 'node:crypto';
import {
  AuthApiErrorResponseSchema,
  AuthCsrfResponseSchema,
  AuthSessionResponseSchema,
  AuthUserResponseSchema,
  AuthLogoutResponseSchema,
  AuthLoginRequestSchema,
  authEndpoints,
} from '@instagram/contracts';
import { AppModule } from '../src/app.module.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { sessionHash } from '../src/auth/auth.service.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';
import {
  AUTH_CONFIG,
  readAuthConfiguration,
  type AuthConfiguration,
} from '../src/auth/auth.config.js';
import { SessionGuard } from '../src/auth/auth-session.guard.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import { configureApp } from '../src/configure-app.js';

const testUrl = readDatabaseUrl(process.env, 'test');
const origin = 'http://localhost:3000';
// Eight Unicode code points, including spaces and a non-BMP character.
const password = 'pa ss 🔐8';
type Agent = ReturnType<typeof request.agent>;
@Controller('__test/protected')
class ProtectedFixture {
  @Get()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  get() {
    return { ok: true };
  }
}
async function createApp(
  url = testUrl,
  config: AuthConfiguration = readAuthConfiguration({ NODE_ENV: 'test' }),
) {
  const fixture = await Test.createTestingModule({
    imports: [AppModule, AuthModule],
    controllers: [ProtectedFixture],
  })
    .overrideProvider(DatabaseService)
    .useFactory({ factory: () => new DatabaseService(url) })
    .overrideProvider(AUTH_CONFIG)
    .useValue(config)
    .compile();
  const app = fixture.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}
function cookieHeaders(response: {
  headers: Record<string, unknown>;
}): string[] {
  const value = response.headers['set-cookie'];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('Expected cookie response');
  return value as string[];
}

describe('Auth HTTP with real PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    app = await createApp();
    database = app.get(DatabaseService);
  });
  afterAll(async () => {
    try {
      await database.prisma.user.deleteMany({
        where: { id: { in: ownedIds } },
      });
    } finally {
      await app.close();
    }
  });
  const agent = () => request.agent(app.getHttpServer());
  async function csrf(client: Agent): Promise<string> {
    const response = await client.get(authEndpoints.csrf.path).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return AuthCsrfResponseSchema.parse(response.body).csrfToken;
  }
  async function post(client: Agent, path: string, body: object) {
    const token = await csrf(client);
    return client
      .post(path)
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send(body);
  }
  async function register(client: Agent) {
    const suffix = randomUUID().replaceAll('-', '');
    const input = {
      email: `${suffix}@example.test`,
      username: `u_${suffix.slice(0, 20)}`,
      password,
    };
    const response = await post(client, authEndpoints.register.path, input);
    expect(response.status).toBe(201);
    const user = AuthUserResponseSchema.parse(response.body).user;
    ownedIds.push(user.id);
    return { input, user };
  }

  it('registers unverified, signs in with an HttpOnly session, hashes passwords and exposes only safe user fields', async () => {
    const client = agent();
    const { input, user } = await register(client);
    expect(user.emailVerified).toBe(false);
    const stored = await database.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.passwordHash.startsWith('scrypt-v1$32768$8$3$')).toBe(true);
    expect(stored.passwordHash.includes(password)).toBe(false);
    expect(stored.emailKey).toBe(input.email.toLowerCase());
    expect(
      AuthSessionResponseSchema.parse(
        (await client.get(authEndpoints.session.path).expect(200)).body,
      ).user,
    ).toEqual(user);
    const sessions = await database.prisma.authSession.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.credentialVersion).toBe(stored.credentialVersion);
  });

  it('sets the registration session cookie with the same flags as login, never in the body', async () => {
    const client = agent();
    const suffix = randomUUID().replaceAll('-', '');
    const response = await post(client, authEndpoints.register.path, {
      email: `${suffix}@example.test`,
      username: `u_${suffix.slice(0, 20)}`,
      password,
    });
    expect(response.status).toBe(201);
    ownedIds.push(AuthUserResponseSchema.parse(response.body).user.id);
    const header = cookieHeaders(response).find((value) =>
      value.startsWith('instagram-session='),
    );
    if (!header) throw new Error('Missing session cookie');
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800'])
      expect(header.includes(flag)).toBe(true);
    const token = header.split(';')[0]!.slice('instagram-session='.length);
    expect(response.text.includes(token)).toBe(false);
  });

  it('uses HttpOnly persistent cookies, stores only a token hash and revokes on logout', async () => {
    const client = agent();
    const { input, user } = await register(client);
    const login = await post(client, authEndpoints.login.path, {
      email: input.email.toUpperCase(),
      password,
    });
    expect(login.status).toBe(200);
    expect(AuthUserResponseSchema.parse(login.body).user).toEqual(user);
    const header = cookieHeaders(login).find((value) =>
      value.startsWith('instagram-session='),
    );
    if (!header) throw new Error('Missing session cookie');
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800'])
      expect(header.includes(flag)).toBe(true);
    const token = header.split(';')[0]!.slice('instagram-session='.length);
    expect(login.text.includes(token)).toBe(false);
    const stored = await database.prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: sessionHash(token) },
    });
    expect(stored.userId).toBe(user.id);
    expect(stored.tokenHash === token).toBe(false);
    expect(
      AuthSessionResponseSchema.parse(
        (await client.get(authEndpoints.session.path).expect(200)).body,
      ).user,
    ).toEqual(user);
    const logout = await post(client, authEndpoints.logout.path, {});
    expect(logout.status).toBe(200);
    expect(AuthLogoutResponseSchema.parse(logout.body)).toEqual({
      status: 'signed_out',
    });
    expect(
      (
        await database.prisma.authSession.findUniqueOrThrow({
          where: { id: stored.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      AuthSessionResponseSchema.parse(
        (await client.get(authEndpoints.session.path).expect(200)).body,
      ).user,
    ).toBeNull();
    expect(
      (
        await request(app.getHttpServer())
          .get(authEndpoints.session.path)
          .set('Cookie', `instagram-session=${token}`)
      ).body,
    ).toEqual({ user: null });
    expect((await post(client, authEndpoints.logout.path, {})).status).toBe(
      200,
    );
  });

  it('keeps independent device sessions isolated when one logs out', async () => {
    const first = agent();
    const second = agent();
    const { input } = await register(first);
    for (const client of [first, second])
      expect(
        (
          await post(client, authEndpoints.login.path, {
            email: input.email,
            password,
          })
        ).status,
      ).toBe(200);
    expect((await post(first, authEndpoints.logout.path, {})).status).toBe(200);
    expect((await first.get(authEndpoints.session.path)).body).toEqual({
      user: null,
    });
    expect(
      AuthSessionResponseSchema.parse(
        (await second.get(authEndpoints.session.path)).body,
      ).user?.email,
    ).toBe(input.email);
  });

  it('denies anonymous protected requests and allows legacy unverified sessions', async () => {
    // Registration signs its own browser in; probe from a separate anonymous one.
    const { input, user } = await register(agent());
    const client = agent();
    expect(
      AuthApiErrorResponseSchema.parse(
        (await client.get('/api/v1/__test/protected').expect(401)).body,
      ).error.code,
    ).toBe('AUTHENTICATION_REQUIRED');
    expect(
      (
        await post(client, authEndpoints.login.path, {
          email: input.email,
          password,
        })
      ).status,
    ).toBe(200);
    expect((await database.prisma.user.findUniqueOrThrow({where:{id:user.id}})).emailVerifiedAt).toBeNull();
    await client.get('/api/v1/__test/protected').expect(200);
  });

  it('rejects expired, revoked and outdated-credential sessions', async () => {
    for (const state of ['expired', 'revoked', 'outdated'] as const) {
      const client = agent();
      const { input, user } = await register(client);
      expect(
        (
          await post(client, authEndpoints.login.path, {
            email: input.email,
            password,
          })
        ).status,
      ).toBe(200);
      if (state === 'expired')
        await database.prisma.authSession.updateMany({
          where: { userId: user.id },
          data: {
            createdAt: new Date(Date.now() - 60_000),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
      if (state === 'revoked')
        await database.prisma.authSession.updateMany({
          where: { userId: user.id },
          data: { revokedAt: new Date() },
        });
      if (state === 'outdated')
        await database.prisma.user.update({
          where: { id: user.id },
          data: { credentialVersion: { increment: 1 } },
        });
      expect(
        (await client.get(authEndpoints.session.path).expect(200)).body,
      ).toEqual({ user: null });
      await client.get('/api/v1/__test/protected').expect(401);
    }
  });

  it('returns the same generic error for unknown emails and incorrect passwords', async () => {
    const { input } = await register(agent());
    const client = agent();
    const errors = [];
    for (const email of [input.email, `${randomUUID()}@example.test`]) {
      const response = await post(client, authEndpoints.login.path, {
        email,
        password: 'incorrect example password',
      });
      expect(response.status).toBe(401);
      const error = AuthApiErrorResponseSchema.parse(response.body).error;
      errors.push({ code: error.code, message: error.message });
    }
    expect(errors[0]).toEqual(errors[1]);
    expect((await client.get(authEndpoints.session.path)).body).toEqual({
      user: null,
    });
  });

  it('does not issue a session if credentials change during password verification', async () => {
    const { input, user } = await register(agent());
    const client = agent();
    const registrationSessions = await database.prisma.authSession.count({
      where: { userId: user.id },
    });
    const hasher = app.get(PasswordHasher);
    const verify = hasher.verify.bind(hasher);
    const spy = vi
      .spyOn(hasher, 'verify')
      .mockImplementationOnce(async (value, encoded) => {
        const valid = await verify(value, encoded);
        await database.prisma.user.update({
          where: { id: user.id },
          data: { credentialVersion: { increment: 1 } },
        });
        return valid;
      });
    try {
      expect(
        (
          await post(client, authEndpoints.login.path, {
            email: input.email,
            password,
          })
        ).status,
      ).toBe(401);
      expect(
        await database.prisma.authSession.count({ where: { userId: user.id } }),
      ).toBe(registrationSessions);
    } finally {
      spy.mockRestore();
    }
  });

  it('sets production host-only Secure cookies for a TLS-terminating origin', async () => {
    const secureOrigin = 'https://app.example.test';
    const secure = await createApp(
      testUrl,
      readAuthConfiguration({
        NODE_ENV: 'production',
        AUTH_PUBLIC_ORIGIN: secureOrigin,
        AUTH_CSRF_SECRET: 'b'.repeat(64),
      }),
    );
    try {
      const csrfResponse = await request(secure.getHttpServer())
        .get(authEndpoints.csrf.path)
        .expect(200);
      const csrfToken = AuthCsrfResponseSchema.parse(
        csrfResponse.body,
      ).csrfToken;
      const csrfCookie = cookieHeaders(csrfResponse)
        .find((value) => value.startsWith('__Host-instagram-csrf='))
        ?.split(';')[0];
      if (!csrfCookie) throw new Error('Missing production CSRF cookie');
      const input = {
        email: `${randomUUID()}@example.test`,
        username: `u_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        password,
      };
      const registration = await request(secure.getHttpServer())
        .post(authEndpoints.register.path)
        .set('Cookie', csrfCookie)
        .set('Origin', secureOrigin)
        .set('X-CSRF-Token', csrfToken)
        .send(input)
        .expect(201);
      ownedIds.push(AuthUserResponseSchema.parse(registration.body).user.id);
      const login = await request(secure.getHttpServer())
        .post(authEndpoints.login.path)
        .set('Cookie', csrfCookie)
        .set('Origin', secureOrigin)
        .set('X-CSRF-Token', csrfToken)
        .send({ email: input.email, password })
        .expect(200);
      const cookie = cookieHeaders(login).find((value) =>
        value.startsWith('__Host-instagram-session='),
      );
      if (!cookie) throw new Error('Missing production session cookie');
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'])
        expect(cookie.includes(flag)).toBe(true);
      expect(cookie.toLowerCase().includes('domain=')).toBe(false);
    } finally {
      await secure.close();
    }
  });

  it('rejects concurrent duplicate registration with a generic conflict', async () => {
    const first = agent();
    const second = agent();
    const suffix = randomUUID().replaceAll('-', '');
    const input = {
      email: `${suffix}@example.test`,
      username: `u_${suffix.slice(0, 20)}`,
      password,
    };
    const results = await Promise.all([
      post(first, authEndpoints.register.path, input),
      post(second, authEndpoints.register.path, {
        ...input,
        email: input.email.toUpperCase(),
        username: input.username.toUpperCase(),
      }),
    ]);
    expect(
      results.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    for (const response of results) {
      if (response.status === 201)
        ownedIds.push(AuthUserResponseSchema.parse(response.body).user.id);
      else
        expect(AuthApiErrorResponseSchema.parse(response.body).error.code).toBe(
          'ACCOUNT_UNAVAILABLE',
        );
    }
  });

  it('rejects missing, mismatched, forged and cross-origin CSRF requests', async () => {
    const client = agent();
    const token = await csrf(client);
    const body = { email: `${randomUUID()}@example.test`, password };
    const responses = [
      await client
        .post(authEndpoints.login.path)
        .set('Origin', origin)
        .send(body),
      await client
        .post(authEndpoints.login.path)
        .set('X-CSRF-Token', token)
        .send(body),
      await client
        .post(authEndpoints.login.path)
        .set('Origin', 'https://attacker.test')
        .set('X-CSRF-Token', token)
        .send(body),
      await client
        .post(authEndpoints.login.path)
        .set('Origin', origin)
        .set('X-CSRF-Token', token.slice(0, -1) + '!')
        .send(body),
    ];
    const forged = `${'A'.repeat(43)}.${Math.floor(Date.now() / 1000)}.${'B'.repeat(43)}`;
    responses.push(
      await request(app.getHttpServer())
        .post(authEndpoints.login.path)
        .set('Cookie', `instagram-csrf=${forged}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', forged)
        .send(body),
    );
    const expired = `${'A'.repeat(43)}.${Math.floor(Date.now() / 1000) - 3601}`;
    const config = app.get<AuthConfiguration>(AUTH_CONFIG);
    const signature = createHmac(
      'sha256',
      Buffer.from(config.csrfSecret, 'hex'),
    )
      .update(expired)
      .digest('base64url');
    const expiredToken = `${expired}.${signature}`;
    responses.push(
      await request(app.getHttpServer())
        .post(authEndpoints.login.path)
        .set('Cookie', `instagram-csrf=${expiredToken}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', expiredToken)
        .send(body),
    );
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(AuthApiErrorResponseSchema.parse(response.body).error.code).toBe(
        'REQUEST_FORBIDDEN',
      );
    }
  });

  it('rejects extra fields and redacts malformed/oversized JSON parser errors', async () => {
    const client = agent();
    const token = await csrf(client);
    const extra = await post(client, authEndpoints.register.path, {
      email: `${randomUUID()}@example.test`,
      username: 'valid_user',
      password,
      emailVerified: true,
    });
    expect(extra.status).toBe(400);
    for (const [body, status] of [
      ['{"password":"PRIVATE_INPUT", broken}', 400],
      [JSON.stringify({ password: 'x'.repeat(110_000) }), 413],
    ] as const) {
      const response = await client
        .post(authEndpoints.register.path)
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(response.status).toBe(status);
      expect(AuthApiErrorResponseSchema.parse(response.body).error.code).toBe(
        'INVALID_REQUEST',
      );
      expect(response.text.includes('PRIVATE_INPUT')).toBe(false);
    }
  });

  it('documents the actual operations and shared schemas in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);
    const document = response.body as {
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: { content: Record<string, { schema: unknown }> };
            responses: Record<
              string,
              { content?: Record<string, { schema: unknown }> }
            >;
            security?: unknown;
          }
        >
      >;
    };
    for (const endpoint of Object.values(authEndpoints))
      expect(
        document.paths[endpoint.path]?.[endpoint.method.toLowerCase()],
      ).toBeDefined();
    expect(
      document.paths[authEndpoints.login.path]!.post!.requestBody!.content[
        'application/json'
      ]!.schema,
    ).toEqual(AuthLoginRequestSchema.toJSONSchema({ target: 'openapi-3.0' }));
  });

  it('returns safe errors when PostgreSQL denies access', async () => {
    const forbidden = new URL(testUrl);
    forbidden.pathname = new URL(
      readDatabaseUrl(process.env, 'development'),
    ).pathname;
    const unavailable = await createApp(forbidden.href);
    try {
      const client = request.agent(unavailable.getHttpServer());
      const response = await post(client, authEndpoints.register.path, {
        email: `${randomUUID()}@example.test`,
        username: 'valid_user',
        password,
      });
      expect([500, 503]).toContain(response.status);
      expect(AuthApiErrorResponseSchema.safeParse(response.body).success).toBe(
        true,
      );
      expect(response.text.includes(forbidden.href)).toBe(false);
      expect(
        response.text.includes(decodeURIComponent(forbidden.password)),
      ).toBe(false);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await unavailable.close();
    }
  });

  it('limits repeated login attempts with a safe Retry-After response', async () => {
    const client = agent();
    const email = `${randomUUID()}@example.test`;
    for (let index = 0; index < 5; index++)
      expect(
        (await post(client, authEndpoints.login.path, { email, password }))
          .status,
      ).toBe(401);
    const response = await post(client, authEndpoints.login.path, {
      email,
      password,
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(AuthApiErrorResponseSchema.parse(response.body).error.code).toBe(
      'TOO_MANY_REQUESTS',
    );
  });
});
