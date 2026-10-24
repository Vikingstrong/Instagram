export const MAIL_CONFIG = Symbol('MAIL_CONFIG');
export type MailConfiguration = {
  enabled: boolean;
  key?: string;
  host: string;
  port: number;
  from: string;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  worker: boolean;
};

// Recovery is optional in every environment, including production. No implicit
// localhost SMTP, development mailbox, generated key or registration dependency.
export function readMailConfiguration(
  env: NodeJS.ProcessEnv,
): MailConfiguration {
  const production = env.NODE_ENV === 'production';
  if (
    env.PASSWORD_RECOVERY_ENABLED !== undefined &&
    !['true', 'false'].includes(env.PASSWORD_RECOVERY_ENABLED)
  )
    throw new Error('PASSWORD_RECOVERY_ENABLED must be true or false.');
  if (env.PASSWORD_RECOVERY_ENABLED !== 'true')
    return {
      enabled: false,
      key: undefined,
      host: '',
      port: 587,
      from: '',
      secure: false,
      requireTLS: production,
      worker: false,
    };
  const key = env.MAIL_OUTBOX_KEY;
  if (key !== undefined && !/^[0-9a-f]{64}$/.test(key))
    throw new Error(
      'MAIL_OUTBOX_KEY must contain a persistent 32-byte lowercase-hex secret.',
    );
  for (const name of ['SMTP_SECURE', 'MAIL_WORKER_ENABLED'])
    if (env[name] !== undefined && !['true', 'false'].includes(env[name]!))
      throw new Error(`${name} must be true or false.`);
  if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined))
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together.');
  const enabled = true;
  const host = env.SMTP_HOST ?? '';
  const from = env.SMTP_FROM ?? '';
  const port = Number(env.SMTP_PORT ?? 587);
  if (
    enabled &&
    (!host ||
      !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535)
  )
    throw new Error(
      'SMTP_HOST, SMTP_PORT and SMTP_FROM must be valid server configuration.',
    );
  if (enabled && !key)
    throw new Error(
      'Configure a persistent MAIL_OUTBOX_KEY to enable password recovery.',
    );
  if (!enabled && env.MAIL_WORKER_ENABLED === 'true')
    throw new Error(
      'Configure SMTP_HOST and SMTP_FROM before enabling mail workers.',
    );
  return {
    enabled,
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
      enabled &&
      (env.MAIL_WORKER_ENABLED === undefined
        ? env.NODE_ENV !== 'test'
        : env.MAIL_WORKER_ENABLED === 'true'),
  };
}
