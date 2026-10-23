import { createHmac } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
export const CALLS_CONFIG = Symbol('CALLS_CONFIG');
export function readCallsConfig(env: NodeJS.ProcessEnv) {
  const stun = (env.CALLS_STUN_URLS ?? '').split(',').filter(Boolean);
  const turn = (env.CALLS_TURN_URLS ?? '').split(',').filter(Boolean);
  if (
    stun.some((url) => !/^stun:[^\s]+$/.test(url)) ||
    turn.some((url) => !/^turns?:[^\s]+$/.test(url))
  )
    throw new Error('Invalid calls ICE URLs.');
  if (
    turn.length &&
    (!env.CALLS_TURN_SECRET || env.CALLS_TURN_SECRET.length < 32)
  )
    throw new Error('CALLS_TURN_SECRET requires at least 32 characters.');
  return {
    stun,
    turn,
    secret: env.CALLS_TURN_SECRET,
    production: env.NODE_ENV === 'production',
  };
}
export type CallsConfig = ReturnType<typeof readCallsConfig>;
export function iceConfiguration(config: CallsConfig, userId: string) {
  if (config.production && !config.turn.length)
    throw new AuthError('CALLS_UNAVAILABLE');
  const iceServers: {
    urls: string[];
    username?: string;
    credential?: string;
  }[] = [];
  if (config.stun.length) iceServers.push({ urls: config.stun });
  if (config.turn.length) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
    iceServers.push({
      urls: config.turn,
      username,
      credential: createHmac('sha1', config.secret!)
        .update(username)
        .digest('base64'),
    });
  }
  return { iceServers };
}
