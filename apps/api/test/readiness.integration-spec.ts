import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
} from '../src/contracts/foundation.js';

const testUrl = readDatabaseUrl(process.env, 'test');

async function createApplication(url: string): Promise<INestApplication<App>> {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useFactory({ factory: () => new DatabaseService(url) })
    .compile();
  const app = module.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('Readiness HTTP with real PostgreSQL', () => {
  it('queries the isolated test database and returns the agreed 200 response', async () => {
    const app = await createApplication(testUrl);
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/readiness')
        .expect(200);
      expect(ReadinessResponseSchema.parse(response.body)).toEqual({
        status: 'ready',
      });
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('returns safe 503 when PostgreSQL rejects the connection', async () => {
    // Test role is deliberately denied CONNECT to the development database.
    // This is a real PostgreSQL refusal, without stopping a shared service.
    const forbidden = new URL(testUrl);
    forbidden.pathname = new URL(
      readDatabaseUrl(process.env, 'development'),
    ).pathname;
    const app = await createApplication(forbidden.toString());
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/readiness')
        .expect(503);
      expect(ApiErrorResponseSchema.safeParse(response.body).success).toBe(
        true,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      if (forbidden.password) {
        expect(response.text).not.toContain(
          decodeURIComponent(forbidden.password),
        );
      }
      expect(response.text).not.toContain(forbidden.toString());
    } finally {
      await app.close();
    }
  });
});
