import type { CallSignal, Live } from "@instagram/contracts";

import type { ApiFailure } from "@/lib/api/client";
import { createLivesClient, type LivesClient } from "@/lib/api/lives";
import { describeFailure } from "@/lib/api/messages";

import { ViewerTransport } from "./live-transport";

export type ViewerPhase =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "full"; live: Live }
  | { state: "error"; message: string }
  | { state: "watching"; live: Live; connected: boolean }
  | { state: "ended"; live: Live };

type Media = {
  start(iceServers: RTCIceServer[]): Promise<void>;
  consume(signal: CallSignal): Promise<void>;
  close(): void;
};
export type ViewerEvents = {
  phase: (next: ViewerPhase | ((current: ViewerPhase) => ViewerPhase)) => void;
  stream: (stream?: MediaStream) => void;
  // The stream is the viewer's own: the host page shows it.
  own: () => void;
};
type MediaFactory = (
  send: (signal: CallSignal) => Promise<void>,
  stream: (stream: MediaStream) => void,
  state: (state: RTCPeerConnectionState) => void,
  failed: () => void,
) => Media;

const code = (failure: ApiFailure) =>
  failure.kind === "api" ? failure.error.code : undefined;
const watching =
  (patch: Partial<Extract<ViewerPhase, { state: "watching" }>>) =>
  (current: ViewerPhase): ViewerPhase =>
    current.state === "watching" ? { ...current, ...patch } : current;

// FR-12 viewer session, outside React: joins as one peer, receives the
// host's media and keeps the connection alive. A failed or silent
// connection, an API restart or a replaced tab join again with a new peer;
// the end of the stream or lost access stop it for good.
export class ViewerSession {
  private media?: Media;
  private peerId?: string;
  private cursor = 0;
  private busy = false;
  private stopped = false;
  private connected = false;
  private joinedAt = 0;
  private reconnectAt = 0;
  private heartbeatAt = 0;
  private healthyAt = 0;
  private disconnected?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  // Each connect() attempt; an older one that resumes after await gives up.
  private attempt = 0;
  private readonly device = crypto.randomUUID();

  constructor(
    private readonly id: string,
    private readonly viewerId: string,
    private readonly events: ViewerEvents,
    private readonly client: LivesClient = createLivesClient(),
    private readonly createMedia: MediaFactory = (...args) => new ViewerTransport(...args),
    private readonly now: () => number = Date.now,
  ) {}

  async open() {
    const result = await this.client.get(this.id);
    if (this.stopped) return;
    if (!result.ok) {
      if (!this.stopOn(result.failure))
        this.events.phase({ state: "error", message: describeFailure(result.failure) });
    } else if (result.data.live.host.id === this.viewerId) this.events.own();
    else if (result.data.live.status === "ENDED")
      this.stop({ state: "ended", live: result.data.live });
    else await this.connect();
  }

  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.peerId) void this.client.leave(this.id, this.device);
    this.drop();
  }

  private drop() {
    clearTimeout(this.disconnected);
    clearTimeout(this.retry);
    this.media?.close();
    this.media = undefined;
    this.peerId = undefined;
    this.connected = false;
    this.events.stream(undefined);
  }

  private stop(next: ViewerPhase) {
    if (this.stopped) return;
    this.dispose();
    this.events.phase(next);
  }

  // Failures that end the viewing; false for the ones worth retrying.
  private stopOn(failure: ApiFailure, live?: Live) {
    const value = code(failure);
    if (
      value === "LIVE_NOT_FOUND" ||
      value === "INVALID_REQUEST" ||
      value === "AUTHENTICATION_REQUIRED"
    )
      this.stop({ state: "unavailable" });
    else if (value === "LIVE_ENDED" && live) this.stop({ state: "ended", live });
    else if (value === "LIVE_ENDED") void this.ended();
    else return false;
    return true;
  }

  private async ended() {
    const result = await this.client.get(this.id);
    if (this.stopped) return;
    this.stop(result.ok ? { state: "ended", live: result.data.live } : { state: "unavailable" });
  }

  async connect() {
    if (this.stopped) return;
    const attempt = ++this.attempt;
    const stale = () => this.stopped || attempt !== this.attempt;
    this.reconnectAt = this.now();
    this.drop();
    const config = await this.client.config();
    if (stale()) return;
    if (!config.ok) {
      if (!this.stopOn(config.failure))
        this.events.phase({ state: "error", message: describeFailure(config.failure) });
      return;
    }
    const joined = await this.client.join(this.id, this.device);
    if (stale()) {
      // A newer attempt joins with the same device and replaces this peer.
      if (joined.ok && this.stopped) void this.client.leave(this.id, this.device);
      return;
    }
    if (!joined.ok) {
      if (code(joined.failure) === "LIVE_FULL") {
        const live = await this.client.get(this.id);
        if (stale()) return;
        if (live.ok) this.events.phase({ state: "full", live: live.data.live });
        else this.stopOn(live.failure);
      } else if (!this.stopOn(joined.failure)) {
        this.events.phase(watching({ connected: false }));
        this.reconnect();
      }
      return;
    }
    const peer = joined.data.peerId;
    this.peerId = peer;
    this.cursor = 0;
    this.joinedAt = this.healthyAt = this.heartbeatAt = this.now();
    this.events.phase({ state: "watching", live: joined.data.live, connected: false });
    const media = this.createMedia(
      async (signal) => {
        const sent = await this.client.sendSignal(this.id, this.device, peer, signal);
        if (!sent.ok) throw new Error(describeFailure(sent.failure));
      },
      (stream) => this.events.stream(stream),
      (state) => {
        if (media !== this.media) return;
        clearTimeout(this.disconnected);
        this.connected = state === "connected";
        this.events.phase(watching({ connected: this.connected }));
        if (state === "failed") this.reconnect();
        // A short network blip may heal by itself.
        if (state === "disconnected")
          this.disconnected = setTimeout(() => this.reconnect(), 5000);
      },
      () => this.reconnect(),
    );
    this.media = media;
    await media.start(config.data.iceServers).catch(() => this.reconnect());
  }

  // At most one new attempt every 3 s.
  reconnect() {
    if (this.stopped) return;
    clearTimeout(this.retry);
    const wait = Math.max(0, this.reconnectAt + 3000 - this.now());
    this.retry = setTimeout(() => void this.connect(), wait);
  }

  async sync() {
    const media = this.media;
    if (this.stopped || !media || !this.peerId || this.busy) return;
    this.busy = true;
    try {
      if (this.now() - this.heartbeatAt > 5000) {
        this.heartbeatAt = this.now();
        const beat = await this.client.heartbeat(this.id, this.device);
        if (this.stopped || media !== this.media) return;
        if (!beat.ok) {
          // Not joined any more (another tab, API restart): join again.
          if (code(beat.failure) === "LIVE_STATE_CONFLICT") this.reconnect();
          else if (!this.stopOn(beat.failure) && this.now() - this.healthyAt > 15000)
            this.reconnect();
          return;
        }
        this.healthyAt = this.now();
        if (beat.data.live.status === "ENDED") {
          this.stop({ state: "ended", live: beat.data.live });
          return;
        }
        this.events.phase(watching({ live: beat.data.live }));
      }
      const result = await this.client.signals(this.id, this.device, this.cursor);
      if (this.stopped || media !== this.media) return;
      if (!result.ok) {
        if (code(result.failure) === "LIVE_STATE_CONFLICT") this.reconnect();
        else this.stopOn(result.failure);
        return;
      }
      for (const item of result.data.items)
        await media.consume(item.signal).catch(() => this.reconnect());
      this.cursor = result.data.next;
      if (!this.connected && this.now() - this.joinedAt > 20000) this.reconnect();
    } finally {
      this.busy = false;
    }
  }
}
