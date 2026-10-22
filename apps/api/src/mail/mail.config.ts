import { randomBytes } from 'node:crypto';

export const MAIL_CONFIG = Symbol('MAIL_CONFIG');
export type MailConfiguration = {
  key?: string;
  host: string;
  port: number;
  from: string;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  worker: boolean;
};

export function readMailConfiguration(
  env: NodeJS.ProcessEnv,
): MailConfiguration {
  const production = env.NODE_ENV === 'production';
  const test = env.NODE_ENV === 'test';
  const key =
    env.MAIL_OUTBOX_KEY ?? (test ? randomBytes(32).toString('hex') : undefined);
  if (
    (key !== undefined && !/^[0-9a-f]{64}$/.test(key)) ||
    (production && !key)
  )
    throw new Error(
      'MAIL_OUTBOX_KEY must contain a persistent 32-byte lowercase-hex secret.',
    );
  const host = env.SMTP_HOST ?? (production ? '' : '127.0.0.1');
  const port = Number(env.SMTP_PORT ?? (production ? 587 : 1025));
  const from = env.SMTP_FROM ?? (production ? '' : 'noreply@example.test');
  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
  )
    throw new Error(
      'SMTP_HOST, SMTP_PORT and SMTP_FROM must be valid server configuration.',
    );
  if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined))
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together.');
  if (
    env.SMTP_SECURE !== undefined &&
    !['true', 'false'].includes(env.SMTP_SECURE)
  )
    throw new Error('SMTP_SECURE must be true or false.');
  if (
    env.MAIL_WORKER_ENABLED !== undefined &&
    !['true', 'false'].includes(env.MAIL_WORKER_ENABLED)
  )
    throw new Error('MAIL_WORKER_ENABLED must be true or false.');
  return {
    key,
    host,
    port,
    from,
    secure: env.SMTP_SECURE === 'true',
    requireTLS: production && env.SMTP_SECURE !== 'true',
    auth:
      env.SMTP_USER === undefined
        ? undefined
        : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD! },
    worker:
      env.MAIL_WORKER_ENABLED === undefined
        ? !test
        : env.MAIL_WORKER_ENABLED === 'true',
  };
}
