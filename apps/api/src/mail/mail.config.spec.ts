import { readMailConfiguration } from './mail.config.js';

describe('Mail configuration', () => {
  it('requires persistent encryption and valid SMTP settings in production', () => {
    expect(() => readMailConfiguration({ NODE_ENV: 'production' })).toThrow(
      'MAIL_OUTBOX_KEY',
    );
    const env = {
      NODE_ENV: 'production',
      MAIL_OUTBOX_KEY: 'a'.repeat(64),
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'sender@example.test',
    };
    expect(readMailConfiguration(env)).toMatchObject({
      key: env.MAIL_OUTBOX_KEY,
      requireTLS: true,
      secure: false,
      worker: true,
    });
    expect(
      readMailConfiguration({ ...env, SMTP_SECURE: 'true' }),
    ).toMatchObject({ secure: true, requireTLS: false });
    for (const invalid of [
      { SMTP_PORT: '0' },
      { SMTP_FROM: 'a\r\nBcc: user@example.test' },
      { SMTP_USER: 'user' },
      { SMTP_SECURE: 'maybe' },
      { MAIL_WORKER_ENABLED: 'maybe' },
    ])
      expect(() => readMailConfiguration({ ...env, ...invalid })).toThrow();
  });
  it('does not invent a persistent development secret or run workers in test fixtures', () => {
    expect(readMailConfiguration({}).key).toBeUndefined();
    expect(readMailConfiguration({ NODE_ENV: 'test' }).worker).toBe(false);
    expect(
      readMailConfiguration({
        NODE_ENV: 'test',
        MAIL_OUTBOX_KEY: 'c'.repeat(64),
      }).key,
    ).toBe('c'.repeat(64));
  });
});
