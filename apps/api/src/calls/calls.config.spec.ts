import { createHmac } from 'node:crypto';
import { iceConfiguration, readCallsConfig } from './calls.config.js';
describe('Call ICE configuration', () => {
  it('allows local development and refuses unconfigured production calls', () => {
    expect(iceConfiguration(readCallsConfig({}), 'user')).toEqual({
      iceServers: [],
    });
    expect(() =>
      iceConfiguration(readCallsConfig({ NODE_ENV: 'production' }), 'user'),
    ).toThrow();
    expect(() => readCallsConfig({ CALLS_TURN_URLS: 'turn:host' })).toThrow();
    expect(() =>
      readCallsConfig({ CALLS_STUN_URLS: 'https://host' }),
    ).toThrow();
  });
  it('issues expiring per-user TURN credentials without exposing the shared secret', () => {
    const secret = 's'.repeat(48);
    const result = iceConfiguration(
      readCallsConfig({
        CALLS_TURN_URLS: 'turn:relay.example:3478',
        CALLS_TURN_SECRET: secret,
      }),
      'user-id',
    );
    const server = result.iceServers[0]!;
    expect(server.username!.endsWith(':user-id')).toBe(true);
    expect(Number(server.username!.split(':')[0])).toBeGreaterThan(
      Date.now() / 1000,
    );
    expect(server.credential).toBe(
      createHmac('sha1', secret).update(server.username!).digest('base64'),
    );
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('uses provider-issued TURN credentials for calls and live streams', () => {
    const urls =
      'turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp';
    const result = iceConfiguration(
      readCallsConfig({
        NODE_ENV: 'production',
        CALLS_TURN_URLS: urls,
        CALLS_TURN_USERNAME: 'provider-user',
        CALLS_TURN_CREDENTIAL: 'provider-password',
      }),
      'user-id',
    );
    expect(result).toEqual({
      iceServers: [
        {
          urls: urls.split(','),
          username: 'provider-user',
          credential: 'provider-password',
        },
      ],
    });
  });
  it('rejects incomplete or mixed TURN credentials', () => {
    const base = { CALLS_TURN_URLS: 'turn:relay.example:3478' };
    expect(() =>
      readCallsConfig({ ...base, CALLS_TURN_USERNAME: 'user' }),
    ).toThrow();
    expect(() =>
      readCallsConfig({ ...base, CALLS_TURN_CREDENTIAL: 'password' }),
    ).toThrow();
    expect(() =>
      readCallsConfig({
        CALLS_TURN_USERNAME: 'user',
        CALLS_TURN_CREDENTIAL: 'password',
      }),
    ).toThrow();
    expect(() =>
      readCallsConfig({
        ...base,
        CALLS_TURN_USERNAME: 'user',
        CALLS_TURN_CREDENTIAL: 'password',
        CALLS_TURN_SECRET: 's'.repeat(32),
      }),
    ).toThrow();
  });
});
