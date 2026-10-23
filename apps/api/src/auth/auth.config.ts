import { randomBytes } from 'node:crypto';

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export type AuthConfiguration = {
  publicOrigin: string;
  allowedOrigins: ReadonlySet<string>;
  secureCookies: boolean;
  csrfSecret: string;
  // Per socket address and 5 minutes. Behind the Next proxy every browser
  // shares one address, so deployments and browser tests may raise these.
  mutationIpLimit: number;
  readIpLimit: number;
};

function positiveLimit(
  name: string,
  value: string | undefined,
  fallback: number,
) {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d{0,6}$/.test(value))
    throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}
export function readAuthConfiguration(
  env: NodeJS.ProcessEnv,
): AuthConfiguration {
  const production = env.NODE_ENV === 'production';
  const value =
    env.AUTH_PUBLIC_ORIGIN ?? (production ? '' : 'http://localhost:3000');
  let url: URL;
  try {
    url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (production && url.protocol !== 'https:')
    )
      throw new Error();
  } catch {
    throw new Error(
      'AUTH_PUBLIC_ORIGIN must be a valid origin (HTTPS in production).',
    );
  }
  let csrfSecret = env.AUTH_CSRF_SECRET;
  if (csrfSecret !== undefined && !/^[0-9a-f]{64}$/.test(csrfSecret))
    throw new Error(
      'AUTH_CSRF_SECRET must contain 32 random bytes encoded as lowercase hex.',
    );
  if (!csrfSecret && production)
    throw new Error('AUTH_CSRF_SECRET is required in production.');
  csrfSecret ??= randomBytes(32).toString('hex');
  const allowedOrigins = new Set([url.origin]);
  // The separate local Swagger UI is a trusted development origin only.
  if (!production && url.origin === 'http://localhost:3000')
    allowedOrigins.add('http://localhost:4000');
  return {
    publicOrigin: url.origin,
    allowedOrigins,
    secureCookies: production,
    csrfSecret,
    mutationIpLimit: positiveLimit(
      'AUTH_MUTATION_IP_LIMIT',
      env.AUTH_MUTATION_IP_LIMIT,
      60,
    ),
    readIpLimit: positiveLimit(
      'AUTH_READ_IP_LIMIT',
      env.AUTH_READ_IP_LIMIT,
      300,
    ),
  };
}
