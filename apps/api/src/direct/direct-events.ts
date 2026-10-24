import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import {
  SessionRevocations,
  type SessionRevocation,
} from '../auth/session-revocations.js';

export const DIRECT_EVENTS_CONFIG = Symbol('DIRECT_EVENTS_CONFIG');
export type DirectEventsConfig = {
  // Heartbeat and session re-check period.
  heartbeatMs: number;
  // Oldest stream of a user is closed when a new one exceeds this.
  maxStreamsPerUser: number;
  // A client that does not read is dropped instead of buffering more.
  maxBufferedBytes: number;
};
export const defaultDirectEventsConfig: DirectEventsConfig = {
  heartbeatMs: 20_000,
  maxStreamsPerUser: 5,
  maxBufferedBytes: 64 * 1024,
};

type Stream = {
  userId: string;
  token: string;
  tokenHash: string;
  response: Response;
};

// Ids only: the text is read through the authorized REST history.
export type DirectNotice = { conversationId: string; messageId: string };

// In-process SSE hub for Direct (one API process, architecture §5). It only
// signals that something changed; PostgreSQL stays the source of truth, so
// a lost notice is repaired by the client's REST sync. Streams end with the
// session: on logout or password reset at once, otherwise at the next
// heartbeat check.
@Injectable()
export class DirectEvents implements OnModuleInit, OnModuleDestroy {
  private readonly streams = new Map<string, Set<Stream>>();
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionRevocations)
    private readonly revocations: SessionRevocations,
    @Inject(DIRECT_EVENTS_CONFIG) private readonly config: DirectEventsConfig,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.revocations.subscribe((revocation) =>
      this.revoke(revocation),
    );
    this.timer = setInterval(
      () => void this.heartbeat(),
      this.config.heartbeatMs,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.unsubscribe?.();
    for (const set of this.streams.values())
      for (const stream of set) this.close(stream);
  }

  // Registers an already opened response and sends "ready": from here on
  // every new message reaches it, so the client may sync history safely.
  open(
    userId: string,
    token: string,
    tokenHash: string,
    response: Response,
  ): void {
    const stream: Stream = { userId, token, tokenHash, response };
    let set = this.streams.get(userId);
    if (!set) this.streams.set(userId, (set = new Set()));
    set.add(stream);
    if (set.size > this.config.maxStreamsPerUser) {
      const [oldest] = set;
      if (oldest) this.close(oldest);
    }
    response.on('close', () => this.forget(stream));
    this.write(stream, 'retry: 3000\nevent: ready\ndata: {}\n\n');
  }

  notify(userIds: string[], notice: DirectNotice): void {
    const frame = `event: message\ndata: ${JSON.stringify(notice)}\n\n`;
    for (const userId of new Set(userIds))
      for (const stream of this.streams.get(userId) ?? [])
        this.write(stream, frame);
  }

  notifyCall(userIds: string[], notice: { callId: string }): void {
    const frame = `event: call\ndata: ${JSON.stringify(notice)}\n\n`;
    for (const userId of new Set(userIds))
      for (const stream of this.streams.get(userId) ?? [])
        this.write(stream, frame);
  }

  // Live streams (FR-12) share the tab stream: ids only, state over REST.
  notifyLive(userIds: string[], notice: { liveId: string }): void {
    const frame = `event: live\ndata: ${JSON.stringify(notice)}\n\n`;
    for (const userId of new Set(userIds))
      for (const stream of this.streams.get(userId) ?? [])
        this.write(stream, frame);
  }

  // An interaction changed; clients reload authorized notification rows.
  notifyNotification(userId: string): void {
    for (const stream of this.streams.get(userId) ?? [])
      this.write(stream, 'event: notification\ndata: {}\n\n');
  }

  count(userId?: string): number {
    if (userId) return this.streams.get(userId)?.size ?? 0;
    let total = 0;
    for (const set of this.streams.values()) total += set.size;
    return total;
  }

  private write(stream: Stream, frame: string): void {
    const { response } = stream;
    if (response.writableEnded || response.destroyed) {
      this.forget(stream);
      return;
    }
    if (response.writableLength > this.config.maxBufferedBytes) {
      this.close(stream);
      return;
    }
    response.write(frame);
  }

  private revoke(revocation: SessionRevocation): void {
    for (const set of this.streams.values())
      for (const stream of set)
        if (
          'tokenHash' in revocation
            ? stream.tokenHash === revocation.tokenHash
            : stream.userId === revocation.userId
        )
          this.close(stream);
  }

  // Keeps proxies from timing out and ends streams whose session expired or
  // was revoked by any other path.
  async heartbeat(): Promise<void> {
    const all = [...this.streams.values()].flatMap((set) => [...set]);
    await Promise.all(
      all.map(async (stream) => {
        // undefined: the check itself failed (database down); keep the
        // stream and try again next time.
        const user = await this.auth
          .session(stream.token)
          .catch(() => undefined);
        if (user === null || (user && user.id !== stream.userId))
          this.close(stream);
        else this.write(stream, ': ping\n\n');
      }),
    );
  }

  private close(stream: Stream): void {
    this.forget(stream);
    if (!stream.response.writableEnded) stream.response.end();
  }

  private forget(stream: Stream): void {
    const set = this.streams.get(stream.userId);
    if (!set) return;
    set.delete(stream);
    if (set.size === 0) this.streams.delete(stream.userId);
  }
}
