import { type INestApplication, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Used by production bootstrap and HTTP tests so prefixes/docs cannot drift.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
  const config = new DocumentBuilder()
    .setTitle('Instagram API')
    .setDescription(
      'Implemented API endpoints. Foundation readiness uses the shared Zod contract.',
    )
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: '/api/docs/openapi.json',
      raw: ['json'],
      swaggerOptions: { validatorUrl: null },
    },
  );
}
