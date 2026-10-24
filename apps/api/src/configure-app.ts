import { type INestApplication, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthSecurity } from './auth/auth-security.js';

// Used by production bootstrap and HTTP tests so prefixes/docs cannot drift.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
  const config = new DocumentBuilder()
    .setTitle('Instagram API')
    .setDescription(
      'Readiness, registration, cookie sessions, optional password recovery. Registration signs in without verification or mail; configured recovery requests use generic accepted responses. Swagger obtains CSRF automatically for same-origin JSON Auth mutations. Local Swagger: http://localhost:4000/api/docs/.',
    )
    .setVersion('1.0')
    .addCookieAuth(
      app.get(AuthSecurity).sessionCookie,
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'Browser-managed HttpOnly cookie; __Host-instagram-session in production.',
      },
      'session',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description:
          'Signed token from GET /api/v1/auth/csrf; also requires its cookie and allowed Origin.',
      },
      'csrfToken',
    )
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: '/api/docs/openapi.json',
      raw: ['json'],
      swaggerOptions: {
        validatorUrl: null,
        requestInterceptor: async (request: {
          url: string;
          method: string;
          headers: Record<string, string>;
          credentials?: string;
        }) => {
          const target = new URL(request.url, window.location.href);
          if (
            target.origin === window.location.origin &&
            /^\/api\/v1\/(?:auth|users|me|search|posts|comments|direct|calls|stories|coins)(?:\/|$)/.test(
              target.pathname,
            ) &&
            request.method.toUpperCase() !== 'GET'
          ) {
            const response = await fetch('/api/v1/auth/csrf', {
              credentials: 'same-origin',
              cache: 'no-store',
            });
            if (!response.ok)
              throw new Error('Unable to prepare CSRF protection.');
            const body: unknown = await response.json();
            if (
              !body ||
              typeof body !== 'object' ||
              !('csrfToken' in body) ||
              typeof body.csrfToken !== 'string'
            )
              throw new Error('Invalid CSRF response.');
            request.headers['X-CSRF-Token'] = body.csrfToken;
          }
          request.credentials = 'same-origin';
          return request;
        },
      },
    },
  );
}
