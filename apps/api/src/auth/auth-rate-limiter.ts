import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthError } from './auth.error.js';

@Injectable()
export class AuthRateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  private nextCleanup = 0;

  consume(
    scope: string,
    identity: string,
    limit: number,
    windowMs: number,
  ): void {
    const now = Date.now();
    if (now >= this.nextCleanup) {
      for (const [key, bucket] of this.buckets)
        if (bucket.until <= now) this.buckets.delete(key);
      this.nextCleanup = now + 60_000;
    }
    // Do not retain raw email addresses or tokens in rate-limit keys.
    const key = `${scope}:${createHash('sha256').update(identity).digest('hex')}`;
    let bucket = this.buckets.get(key);
    if (bucket && bucket.until <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      // Fail closed on saturation; evicting live entries would bypass limits.
      if (this.buckets.size >= 10_000)
        throw new AuthError('TOO_MANY_REQUESTS', 60);
      bucket = { count: 0, until: now + windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= limit)
      throw new AuthError(
        'TOO_MANY_REQUESTS',
        Math.max(1, Math.ceil((bucket.until - now) / 1000)),
      );
    bucket.count += 1;
  }
}
