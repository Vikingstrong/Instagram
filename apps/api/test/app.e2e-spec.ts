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
            responses: Record<
              string,
              { content: Record<string, { schema: unknown }> }
            >;
          };
        }
      >;
    };
    expect(Object.keys(document.paths)).toEqual(['/api/v1/readiness']);
    const responses = document.paths['/api/v1/readiness']!.get.responses;
    expect(responses['200']!.content['application/json']!.schema).toEqual(
      ReadinessResponseSchema.toJSONSchema({ target: 'openapi-3.0' }),
    );
    expect(responses['503']!.content['application/json']!.schema).toEqual(
      ApiErrorResponseSchema.toJSONSchema({ target: 'openapi-3.0' }),
    );
    expect(database.checkConnection).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    await app.close();
  });
});
