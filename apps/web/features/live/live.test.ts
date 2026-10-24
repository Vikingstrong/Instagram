import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallSignal, Live, LiveComment } from "@instagram/contracts";

import type { ApiFailure, ApiResult } from "@/lib/api/client";
import type { LivesClient } from "@/lib/api/lives";

import { mergeComments } from "./live-chat";
import { HostTransport, ViewerTransport } from "./live-transport";
import { ViewerSession, type ViewerPhase } from "./viewer-session";

class Peer {
  static all: Peer[] = [];
  localDescription: { sdp: string } | null = null;
  remoteDescription: unknown = null;
  connectionState = "new";
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: unknown) => void) | null = null;
  addTrack = vi.fn();
  addTransceiver = vi.fn();
  addIceCandidate = vi.fn(async () => {});
  close = vi.fn();
  getSenders = () => [];
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "local offer" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "local answer" }));
  setLocalDescription = vi.fn(async (value: { sdp: string }) => {
    this.localDescription = value;
    // Gathering starts at once: a candidate before the offer is queued.
    this.onicecandidate?.({ candidate: candidate("early") });
  });
  setRemoteDescription = vi.fn(async (value: unknown) => {
    this.remoteDescription = value;
  });
  constructor() {
    Peer.all.push(this);
  }
}
const candidate = (name: string) => ({
  toJSON: () => ({ candidate: name, sdpMid: "0", sdpMLineIndex: 0 }),
});
const ice = (name: string) => ({
  type: "ice" as const,
  candidate: { candidate: name, sdpMid: "0", sdpMLineIndex: 0 },
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Peer.all = [];
});

describe("live transport", () => {
  it("answers each viewer with the same local tracks and closes dropped viewers", async () => {
    vi.stubGlobal("RTCPeerConnection", Peer);
    const tracks = [{ kind: "audio" }, { kind: "video" }];
    const local = { getTracks: () => tracks } as unknown as MediaStream;
    const send = vi.fn<(peer: string, signal: CallSignal) => Promise<void>>(async () => {});
    const host = new HostTransport(local, [], send);
    await host.consume("a", ice("before offer"));
    expect(host.size).toBe(0);
    await host.consume("a", { type: "offer", sdp: "offer a" });
    await host.consume("b", { type: "offer", sdp: "offer b" });
    await host.consume("b", ice("remote b"));
    await flush();
    expect(host.size).toBe(2);
    const [a, b] = Peer.all;
    expect(a!.addTrack).toHaveBeenCalledTimes(2);
    expect(b!.addIceCandidate).toHaveBeenCalledWith(ice("remote b").candidate);
    // Per viewer: the answer goes out before its candidates.
    const toA = send.mock.calls.filter(([peer]) => peer === "a");
    expect(toA.map(([, signal]) => signal.type)).toEqual(["answer", "ice"]);
    host.retain(["b"]);
    expect(a!.close).toHaveBeenCalled();
    expect(host.size).toBe(1);
    // A new offer from the same viewer replaces its connection.
    await host.consume("b", { type: "offer", sdp: "offer b2" });
    expect(b!.close).toHaveBeenCalled();
    host.stop();
    expect(Peer.all[2]!.close).toHaveBeenCalled();
    expect(host.size).toBe(0);
  });

  it("receives only, sends the offer before ICE and buffers early remote ICE", async () => {
    vi.stubGlobal("RTCPeerConnection", Peer);
    const sent: string[] = [];
    const viewer = new ViewerTransport(
      async (signal) => {
        sent.push(signal.type === "ice" ? `ice:${signal.candidate.candidate}` : signal.type);
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    await viewer.start([]);
    const pc = Peer.all[0]!;
    pc.onicecandidate?.({ candidate: candidate("late") });
    await flush();
    expect(pc.addTransceiver).toHaveBeenCalledWith("video", { direction: "recvonly" });
    expect(pc.addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
    expect(sent).toEqual(["offer", "ice:early", "ice:late"]);
    await viewer.consume(ice("host"));
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    await viewer.consume({ type: "answer", sdp: "answer" });
    expect(pc.addIceCandidate).toHaveBeenCalledOnce();
    viewer.close();
    expect(pc.close).toHaveBeenCalled();
  });
});

const host = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "host",
  displayName: "",
  avatarUrl: null,
  isPrivate: false,
};
const live = (status: Live["status"] = "LIVE"): Live => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  host,
  status,
  startedAt: "2026-10-24T10:00:00.000Z",
  endedAt: status === "ENDED" ? "2026-10-24T10:30:00.000Z" : null,
  viewerCount: 1,
});
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
const fail = (code: string, status = 409): ApiResult<never> => ({
  ok: false,
  failure: {
    kind: "api",
    status,
    error: { code, message: "x", requestId: "r" },
  } as unknown as ApiFailure,
});
function client(overrides: Partial<Record<keyof LivesClient, unknown>> = {}) {
  return {
    get: vi.fn(async () => ok({ live: live() })),
    config: vi.fn(async () => ok({ iceServers: [] })),
    join: vi.fn(async () => ok({ live: live(), peerId: crypto.randomUUID() })),
    leave: vi.fn(async () => ok({ status: "accepted" })),
    heartbeat: vi.fn(async () => ok({ live: live() })),
    signals: vi.fn(async () => ok({ items: [], peers: [], next: 0 })),
    sendSignal: vi.fn(async () => ok({ status: "accepted" })),
    ...overrides,
  } as unknown as LivesClient;
}
function media() {
  const created: { close: ReturnType<typeof vi.fn>; state: (value: string) => void }[] = [];
  const factory = (
    _send: unknown,
    _stream: unknown,
    state: (value: RTCPeerConnectionState) => void,
  ) => {
    const item = {
      start: vi.fn(async () => {}),
      consume: vi.fn(async () => {}),
      close: vi.fn(),
      state: state as (value: string) => void,
    };
    created.push(item);
    return item;
  };
  return { created, factory };
}

describe("viewer session", () => {
  it("joins, reconnects after a failed connection and stops when the stream ends", async () => {
    vi.useFakeTimers();
    let time = 1_000_000;
    const api = client();
    const { created, factory } = media();
    const phases: ViewerPhase[] = [];
    let phase: ViewerPhase = { state: "loading" };
    const session = new ViewerSession(
      live().id,
      "viewer",
      {
        phase: (next) => {
          phase = typeof next === "function" ? next(phase) : next;
          phases.push(phase);
        },
        stream: vi.fn(),
        own: vi.fn(),
        banned: vi.fn(),
      },
      api,
      factory,
      () => time,
    );
    await session.open();
    expect(api.join).toHaveBeenCalledOnce();
    expect(phase).toMatchObject({ state: "watching", connected: false });
    created[0]!.state("connected");
    expect(phase).toMatchObject({ state: "watching", connected: true });
    created[0]!.state("failed");
    time += 3000;
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.join).toHaveBeenCalledTimes(2);
    expect(created[0]!.close).toHaveBeenCalled();

    time += 6000;
    vi.mocked(api.heartbeat).mockResolvedValueOnce(ok({ live: live("ENDED") }));
    await session.sync();
    expect(phase).toMatchObject({ state: "ended" });
    expect(api.leave).toHaveBeenCalled();
    expect(created[1]!.close).toHaveBeenCalled();
  });

  it("stops without access, sends the host to their own page and waits when full", async () => {
    const events = () => ({ phase: vi.fn(), stream: vi.fn(), own: vi.fn(), banned: vi.fn() });
    const lost = events();
    const lostApi = client();
    const lostMedia = media();
    let time = 1_000_000;
    const session = new ViewerSession(
      live().id,
      "viewer",
      lost,
      lostApi,
      lostMedia.factory,
      () => time,
    );
    await session.open();
    // The next heartbeat finds that the viewer lost access.
    time += 6000;
    vi.mocked(lostApi.heartbeat).mockResolvedValueOnce(fail("LIVE_NOT_FOUND", 404));
    await session.sync();
    expect(lost.phase).toHaveBeenLastCalledWith({ state: "unavailable" });

    // A ban stops the session and asks the page to leave with the message.
    const kicked = events();
    const kickedApi = client();
    const ban = new ViewerSession(live().id, "viewer", kicked, kickedApi, media().factory, () => time);
    await ban.open();
    vi.mocked(kickedApi.signals).mockResolvedValueOnce(fail("LIVE_BANNED", 403));
    await ban.sync();
    expect(kicked.banned).toHaveBeenCalled();
    expect(kickedApi.leave).toHaveBeenCalled();
    expect(lostMedia.created[0]!.close).toHaveBeenCalled();

    const own = events();
    await new ViewerSession(live().id, host.id, own, client(), media().factory).open();
    expect(own.own).toHaveBeenCalled();

    const full = events();
    await new ViewerSession(
      live().id,
      "viewer",
      full,
      client({ join: vi.fn(async () => fail("LIVE_FULL")) }),
      media().factory,
    ).open();
    expect(full.phase).toHaveBeenLastCalledWith({ state: "full", live: live() });
  });
});

describe("live chat", () => {
  it("merges lines by id in chat order and keeps the latest ones", () => {
    const line = (id: string, at: string): LiveComment => ({
      id,
      author: host,
      text: id,
      createdAt: at,
    });
    const merged = mergeComments(
      [line("b", "2026-10-24T10:00:02.000Z"), line("a", "2026-10-24T10:00:01.000Z")],
      [line("b", "2026-10-24T10:00:02.000Z"), line("c", "2026-10-24T10:00:03.000Z")],
    );
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: 250 }, (_, index) =>
      line(`m${index.toString().padStart(3, "0")}`, `2026-10-24T10:${Math.floor(index / 60).toString().padStart(2, "0")}:${(index % 60).toString().padStart(2, "0")}.000Z`),
    );
    expect(mergeComments([], many)).toHaveLength(200);
    expect(mergeComments([], many)[0]!.id).toBe("m050");
  });
});
