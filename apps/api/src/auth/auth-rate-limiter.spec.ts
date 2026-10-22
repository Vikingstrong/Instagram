import { AuthRateLimiter } from './auth-rate-limiter.js';

describe('AuthRateLimiter', () => {
  afterEach(() => vi.restoreAllMocks());
  it('isolates keys/scopes, denies overflow with Retry-After and permits a new window', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const limiter = new AuthRateLimiter();
    limiter.consume('login', 'one', 1, 10_000);
    expect(() => limiter.consume('login', 'one', 1, 10_000)).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_REQUESTS', retryAfter: 10 }),
    );
    expect(() => limiter.consume('login', 'two', 1, 10_000)).not.toThrow();
    expect(() => limiter.consume('register', 'one', 1, 10_000)).not.toThrow();
    clock.mockReturnValue(11_001);
    expect(() => limiter.consume('login', 'one', 1, 10_000)).not.toThrow();
  });
  it('fails closed when the bounded store fills, and releases expired entries', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const limiter = new AuthRateLimiter();
    for (let index = 0; index < 10_000; index++)
      limiter.consume('key', String(index), 1, 1000);
    expect(() => limiter.consume('key', 'new', 1, 1000)).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }),
    );
    clock.mockReturnValue(61_001);
    expect(() => limiter.consume('key', 'new', 1, 1000)).not.toThrow();
  });
});
