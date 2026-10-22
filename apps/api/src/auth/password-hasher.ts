import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AuthError } from './auth.error.js';

// OWASP scrypt profile: N=2^15, r=8, p=3. Encoded format is versioned.
const prefix = 'scrypt-v1$32768$8$3';
const pattern = /^scrypt-v1\$32768\$8\$3\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private active = 0;
  private dummy?: Promise<string>;

  async onModuleInit(): Promise<void> {
    await this.dummyHash();
  }

  private dummyHash(): Promise<string> {
    this.dummy ??= this.hash(randomBytes(32).toString('hex')).catch(
      (error: unknown) => {
        this.dummy = undefined;
        throw error;
      },
    );
    return this.dummy;
  }

  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    // Bound outstanding work too: do not allow an unbounded libuv work queue.
    if (this.active >= 4) throw new AuthError('SERVICE_UNAVAILABLE');
    this.active += 1;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password,
          salt,
          64,
          { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
          (error, value) => (error ? reject(error) : resolve(value)),
        );
      });
    } finally {
      this.active -= 1;
    }
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await this.derive(password, salt);
    return `${prefix}$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  async verify(password: string, encoded?: string): Promise<boolean> {
    const supplied = encoded?.match(pattern);
    const match = supplied ?? (await this.dummyHash()).match(pattern)!;
    const value = await this.derive(password, Buffer.from(match[1]!, 'hex'));
    return (
      timingSafeEqual(value, Buffer.from(match[2]!, 'hex')) &&
      supplied !== null &&
      supplied !== undefined
    );
  }
}
