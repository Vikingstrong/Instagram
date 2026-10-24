import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { SessionRevocations } from '../auth/session-revocations.js';
import { DirectEvents } from './direct-events.js';

// Minimal writable response: records frames and lets a test fake a client
// that stopped reading (writableLength grows).
class FakeResponse extends EventEmitter {
  frames: string[] = [];
  writableLength = 0;
  writableEnded = false;
  destroyed = false;
  write(frame: string) {
    this.frames.push(frame);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
}

function hub(session: AuthService['session'] = () => Promise.resolve(null)) {
  const revocations = new SessionRevocations();
  const events = new DirectEvents({ session } as AuthService, revocations, {
    heartbeatMs: 60_000,
    maxStreamsPerUser: 2,
    maxBufferedBytes: 100,
  });
  events.onModuleInit();
  return { events, revocations };
}
const open = (events: DirectEvents, userId: string, tokenHash = userId) => {
  const response = new FakeResponse();
  events.open(userId, 'token', tokenHash, response as unknown as Response);
  return response;
};

describe('DirectEvents', () => {
  it('sends ready first, then notices only to the participants', () => {
    const { events } = hub();
    const alice = open(events, 'alice');
    const bob = open(events, 'bob');
    const eve = open(events, 'eve');
    events.notify(['alice', 'bob', 'alice'], {
      conversationId: 'c',
      messageId: 'm',
    });
    expect(alice.frames).toEqual([
      'retry: 3000\nevent: ready\ndata: {}\n\n',
      'event: message\ndata: {"conversationId":"c","messageId":"m"}\n\n',
    ]);
    expect(bob.frames).toHaveLength(2);
    expect(eve.frames).toHaveLength(1);
    events.onModuleDestroy();
  });

  it('sends interaction change notices only to the recipient', () => {
    const { events } = hub();
    const alice = open(events, 'alice');
    const bob = open(events, 'bob');
    events.notifyNotification('alice');
    expect(alice.frames.at(-1)).toBe('event: notification\ndata: {}\n\n');
    expect(bob.frames).toHaveLength(1);
    events.onModuleDestroy();
  });

  it('caps streams per user and drops a client that stopped reading', () => {
    const { events } = hub();
    const first = open(events, 'alice');
    open(events, 'alice');
    open(events, 'alice');
    expect(first.writableEnded).toBe(true);
    expect(events.count('alice')).toBe(2);

    const slow = open(events, 'bob');
    slow.writableLength = 101;
    events.notify(['bob'], { conversationId: 'c', messageId: 'm' });
    expect(slow.writableEnded).toBe(true);
    expect(events.count('bob')).toBe(0);
    events.onModuleDestroy();
    expect(events.count()).toBe(0);
  });

  it('closes streams on revocation and on a failed session check', async () => {
    let valid = true;
    const { events, revocations } = hub(() =>
      Promise.resolve(
        valid
          ? {
              id: 'carol',
              email: 'c@example.test',
              username: 'carol',
              emailVerified: true,
            }
          : null,
      ),
    );
    const one = open(events, 'alice', 'hash-1');
    const two = open(events, 'alice', 'hash-2');
    revocations.publish({ tokenHash: 'hash-1' });
    expect(one.writableEnded).toBe(true);
    expect(two.writableEnded).toBe(false);
    revocations.publish({ userId: 'alice' });
    expect(two.writableEnded).toBe(true);

    const carol = open(events, 'carol');
    await events.heartbeat();
    expect(carol.frames.at(-1)).toBe(': ping\n\n');
    valid = false;
    await events.heartbeat();
    expect(carol.writableEnded).toBe(true);
    events.onModuleDestroy();
  });
});
