import { randomUUID } from 'node:crypto';
import type { CallSignal, UserSummary } from '@instagram/contracts';
import { AuthError } from '../auth/auth.error.js';

export type LivePeer = {
  peerId: string;
  userId: string;
  hash: string;
  clientId: string;
  user: UserSummary;
  seenAt: number;
  // Host → viewer signals the viewer has not acknowledged yet.
  inbox: { sequence: number; signal: CallSignal }[];
  sequence: number;
  chars: number;
};
type Room = {
  hostId: string;
  peers: Map<string, LivePeer>;
  // Viewer → host signals the host has not acknowledged yet.
  inbox: { sequence: number; peerId: string; signal: CallSignal }[];
  sequence: number;
  chars: number;
};
// Unread SDP/ICE per direction; a peer that floods them has to join again.
const limits = {
  peer: { items: 256, chars: 262_144 },
  host: { items: 2048, chars: 1_048_576 },
};
const size = (signal: CallSignal) => JSON.stringify(signal).length;

// Connections of live streams, in memory of the one API process
// (architecture §5): viewer peers and the signals they exchange with the
// host. Nothing here is stored; after a restart viewers join again.
export class LiveRooms {
  private readonly rooms = new Map<string, Room>();

  room(liveId: string, hostId: string): Room {
    let room = this.rooms.get(liveId);
    if (!room)
      this.rooms.set(
        liveId,
        (room = {
          hostId,
          peers: new Map(),
          inbox: [],
          sequence: 0,
          chars: 0,
        }),
      );
    return room;
  }

  ids(): string[] {
    return [...this.rooms.keys()];
  }

  hostOf(liveId: string): string | undefined {
    return this.rooms.get(liveId)?.hostId;
  }

  count(liveId: string): number {
    return this.rooms.get(liveId)?.peers.size ?? 0;
  }

  viewers(liveId: string): LivePeer[] {
    return [...(this.rooms.get(liveId)?.peers.values() ?? [])];
  }

  // Ends every connection of the stream; returns the viewers to notify.
  drop(liveId: string): string[] {
    const viewers = this.viewers(liveId).map((peer) => peer.userId);
    this.rooms.delete(liveId);
    return viewers;
  }

  // One connection per viewer: a new tab or a reconnect replaces the old
  // peer, so the host closes it instead of sending media twice.
  join(
    liveId: string,
    hostId: string,
    viewer: Pick<LivePeer, 'userId' | 'hash' | 'clientId' | 'user'>,
    maxViewers: number,
  ): LivePeer {
    const room = this.room(liveId, hostId);
    for (const peer of room.peers.values())
      if (peer.userId === viewer.userId) room.peers.delete(peer.peerId);
    if (room.peers.size >= maxViewers) throw new AuthError('LIVE_FULL');
    const peer: LivePeer = {
      ...viewer,
      peerId: randomUUID(),
      seenAt: Date.now(),
      inbox: [],
      sequence: 0,
      chars: 0,
    };
    room.peers.set(peer.peerId, peer);
    return peer;
  }

  // The caller's own connection: same user, session and tab.
  peerOf(
    liveId: string,
    userId: string,
    hash: string,
    clientId: string,
  ): LivePeer | undefined {
    for (const peer of this.viewers(liveId))
      if (
        peer.userId === userId &&
        peer.hash === hash &&
        peer.clientId === clientId
      )
        return peer;
    return undefined;
  }

  remove(liveId: string, peerId: string): boolean {
    return this.rooms.get(liveId)?.peers.delete(peerId) ?? false;
  }

  removeUser(liveId: string, userId: string): boolean {
    let removed = false;
    for (const peer of this.viewers(liveId))
      if (peer.userId === userId) removed = this.remove(liveId, peer.peerId);
    return removed;
  }

  // Removes matching viewers everywhere; returns the affected stream ids.
  removeWhere(match: (peer: LivePeer) => boolean): string[] {
    const affected: string[] = [];
    for (const [liveId, room] of this.rooms)
      for (const peer of room.peers.values())
        if (match(peer)) {
          room.peers.delete(peer.peerId);
          if (!affected.includes(liveId)) affected.push(liveId);
        }
    return affected;
  }

  toPeer(liveId: string, peerId: string, signal: CallSignal): LivePeer {
    const peer = this.rooms.get(liveId)?.peers.get(peerId);
    if (
      !peer ||
      peer.inbox.length >= limits.peer.items ||
      peer.chars + size(signal) > limits.peer.chars
    )
      throw new AuthError('LIVE_STATE_CONFLICT');
    peer.sequence += 1;
    peer.chars += size(signal);
    peer.inbox.push({ sequence: peer.sequence, signal });
    return peer;
  }

  toHost(liveId: string, peerId: string, signal: CallSignal): void {
    const room = this.rooms.get(liveId);
    if (
      !room?.peers.has(peerId) ||
      room.inbox.length >= limits.host.items ||
      room.chars + size(signal) > limits.host.chars
    )
      throw new AuthError('LIVE_STATE_CONFLICT');
    room.sequence += 1;
    room.chars += size(signal);
    room.inbox.push({ sequence: room.sequence, peerId, signal });
  }

  // Reading with a cursor acknowledges everything up to it. Signals of
  // viewers that left are discarded with it.
  hostRead(liveId: string, hostId: string, after: number) {
    const room = this.room(liveId, hostId);
    room.inbox = room.inbox.filter(
      (item) => item.sequence > after && room.peers.has(item.peerId),
    );
    room.chars = room.inbox.reduce(
      (total, item) => total + size(item.signal),
      0,
    );
    return {
      items: room.inbox.map(({ sequence, peerId, signal }) => ({
        sequence,
        peerId,
        signal,
      })),
      peers: [...room.peers.values()].map(({ peerId, user }) => ({
        peerId,
        user,
      })),
      next: room.sequence,
    };
  }

  peerRead(peer: LivePeer, after: number) {
    peer.inbox = peer.inbox.filter((item) => item.sequence > after);
    peer.chars = peer.inbox.reduce(
      (total, item) => total + size(item.signal),
      0,
    );
    return {
      items: peer.inbox.map(({ sequence, signal }) => ({
        sequence,
        peerId: peer.peerId,
        signal,
      })),
      peers: [],
      next: peer.sequence,
    };
  }

  clear(): void {
    this.rooms.clear();
  }
}
