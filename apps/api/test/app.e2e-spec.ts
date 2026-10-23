import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
} from '../src/contracts/foundation.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const database = { checkConnection: vi.fn<() => Promise<void>>() };

  beforeEach(async () => {
    database.checkConnection.mockReset().mockResolvedValue(undefined);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('returns a contract-valid uncached 200 only after the database check', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .expect(200);
    expect(ReadinessResponseSchema.parse(response.body)).toEqual({
      status: 'ready',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(database.checkConnection).toHaveBeenCalledOnce();
  });

  it('returns safe uncached 503 with a fresh request ID on each failed database check', async () => {
    database.checkConnection.mockRejectedValue(
      new Error('postgresql://secret:password@internal/private'),
    );
    const first = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .expect(503);
    const second = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .expect(503);
    const error = ApiErrorResponseSchema.parse(first.body);
    expect(ApiErrorResponseSchema.parse(second.body).error.requestId).not.toBe(
      error.error.requestId,
    );
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.text).not.toMatch(/secret|password|internal|postgresql/);
  });

  it('serves Swagger UI and OpenAPI generated from the shared response schemas', async () => {
    await request(app.getHttpServer())
      .get('/api/docs/')
      .expect(200)
      .expect(/swagger-ui/);
    await request(app.getHttpServer())
      .get('/api/docs/swagger-ui-init.js')
      .expect(200)
      .expect(/getReadiness/);
    const response = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);
    const document = response.body as {
      paths: Record<
        string,
        {
          get: {
            operationId: string;
            tags: string[];
            responses: Record<
              string,
              {
                content: Record<string, { schema: unknown }>;
                headers: Record<string, { schema: unknown }>;
              }
            >;
          };
        }
      >;
    };
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/password/request',
      '/api/v1/auth/password/reset',
      '/api/v1/auth/register',
      '/api/v1/auth/session',
      '/api/v1/auth/verification/confirm',
      '/api/v1/auth/verification/request',
      '/api/v1/comments/{id}',
      '/api/v1/direct/conversations',
      '/api/v1/direct/conversations/{id}',
      '/api/v1/direct/conversations/{id}/messages',
      '/api/v1/direct/events',
      '/api/v1/feed',
      '/api/v1/me/avatar',
      '/api/v1/me/follow-requests',
      '/api/v1/me/follow-requests/{id}/accept',
      '/api/v1/me/follow-requests/{id}/decline',
      '/api/v1/me/followers/{id}',
      '/api/v1/me/profile',
      '/api/v1/me/suggestions',
      '/api/v1/media/{id}/{variant}',
      '/api/v1/posts',
      '/api/v1/posts/video',
      '/api/v1/posts/{id}',
      '/api/v1/posts/{id}/comments',
      '/api/v1/posts/{id}/like',
      '/api/v1/readiness',
      '/api/v1/reels',
      '/api/v1/search/users',
      '/api/v1/users/{id}/follow',
      '/api/v1/users/{id}/followers',
      '/api/v1/users/{id}/following',
      '/api/v1/users/{id}/posts',
      '/api/v1/users/{username}',
    ]);
    const operation = document.paths['/api/v1/readiness']!.get;
    expect(operation.operationId).toBe('getReadiness');
    expect(operation.tags).toContain('Foundation');
    const responses = operation.responses;
    expect(responses['200']!.content['application/json']!.schema).toEqual(
      ReadinessResponseSchema.toJSONSchema({ target: 'openapi-3.0' }),
    );
    expect(responses['503']!.content['application/json']!.schema).toEqual(
      ApiErrorResponseSchema.toJSONSchema({ target: 'openapi-3.0' }),
    );
    for (const status of ['200', '503']) {
      expect(responses[status]!.headers['Cache-Control']!.schema).toEqual({
        type: 'string',
        enum: ['no-store'],
      });
    }
    expect(database.checkConnection).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    await app.close();
  });
});
