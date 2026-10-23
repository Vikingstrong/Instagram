import { randomUUID } from 'node:crypto';
import { LiveRooms } from './live-rooms.js';
import { liveIceConfiguration } from './lives.service.js';
import { readCallsConfig } from '../calls/calls.config.js';

const viewer = (userId: string) => ({
  userId,
  hash: 'hash',
  clientId: randomUUID(),
  user: {
    id: userId,
    username: 'viewer',
    displayName: '',
    avatarUrl: null,
    isPrivate: false,
  },
});
const ice = {
  type: 'ice',
  candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 },
} as const;

describe('Live rooms', () => {
  it('bounds unread signals and forgets the ones of viewers that left', () => {
    const rooms = new LiveRooms(),
      live = randomUUID(),
      host = randomUUID();
    const peer = rooms.join(live, host, viewer(randomUUID()), 10);
    for (let i = 0; i < 256; i++) rooms.toPeer(live, peer.peerId, ice);
    expect(() => rooms.toPeer(live, peer.peerId, ice)).toThrow();
    // Acknowledging frees the buffer.
    expect(rooms.peerRead(peer, 256).items).toEqual([]);
    rooms.toPeer(live, peer.peerId, ice);

    rooms.toHost(live, peer.peerId, ice);
    expect(rooms.hostRead(live, host, 0).items).toHaveLength(1);
    rooms.remove(live, peer.peerId);
    expect(rooms.hostRead(live, host, 0)).toEqual({
      items: [],
      peers: [],
      next: 1,
    });
    expect(() => rooms.toHost(live, peer.peerId, ice)).toThrow();
  });

  it('keeps one connection per viewer and a viewer limit', () => {
    const rooms = new LiveRooms(),
      live = randomUUID(),
      host = randomUUID(),
      userId = randomUUID();
    const first = rooms.join(live, host, viewer(userId), 2);
    const second = rooms.join(live, host, viewer(userId), 2);
    expect(rooms.viewers(live).map((peer) => peer.peerId)).toEqual([
      second.peerId,
    ]);
    expect(first.peerId).not.toBe(second.peerId);
    rooms.join(live, host, viewer(randomUUID()), 2);
    expect(() => rooms.join(live, host, viewer(randomUUID()), 2)).toThrow();
    expect(rooms.drop(live)).toHaveLength(2);
    expect(rooms.count(live)).toBe(0);
  });

  it('refuses production streams without TURN', () => {
    expect(() =>
      liveIceConfiguration(readCallsConfig({ NODE_ENV: 'production' }), 'u'),
    ).toThrow();
    expect(liveIceConfiguration(readCallsConfig({}), 'u')).toEqual({
      iceServers: [],
    });
  });
});
