import type { CallSignal } from "@instagram/contracts";

// P-15 media for live streams: the host's browser keeps one
// RTCPeerConnection per viewer and sends them all the same local tracks.
// Viewers offer receive-only; the host answers. Media never passes through
// the API, and the REST/SSE flow does not depend on this file, so an SFU
// adapter can replace it.

function iceSignal(candidate: RTCIceCandidate): CallSignal {
  const json = candidate.toJSON();
  return {
    type: "ice",
    candidate: {
      candidate: json.candidate ?? "",
      sdpMid: json.sdpMid ?? null,
      sdpMLineIndex: json.sdpMLineIndex ?? null,
      usernameFragment: json.usernameFragment ?? null,
    },
  };
}

// Sends one direction's signals strictly in order: an ICE candidate must
// never reach the API before the description it belongs to.
function sequence(
  send: (signal: CallSignal) => Promise<void>,
  failed: () => void,
) {
  let chain = Promise.resolve();
  return (signal: CallSignal) => {
    chain = chain.then(() => send(signal)).catch(failed);
  };
}

type HostPeer = {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  send: (signal: CallSignal) => void;
  // Own candidates found before the answer is queued wait for it.
  early?: RTCIceCandidate[];
};

export class HostTransport {
  private readonly peers = new Map<string, HostPeer>();
  private closed = false;

  constructor(
    private readonly local: MediaStream,
    private readonly iceServers: RTCIceServer[],
    private readonly send: (peerId: string, signal: CallSignal) => Promise<void>,
    // Per viewer: the host's uplink carries one copy for each of them.
    private readonly maxBitrate = 1_000_000,
  ) {}

  get size() {
    return this.peers.size;
  }

  connections() {
    return [...this.peers.values()].map((peer) => peer.pc);
  }

  // A viewer's signals in order. An offer (re)starts that viewer's peer.
  async consume(peerId: string, signal: CallSignal) {
    if (this.closed) return;
    if (signal.type === "offer") {
      this.close(peerId);
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      const peer: HostPeer = {
        pc,
        pendingIce: [],
        early: [],
        send: sequence(
          (value) => this.send(peerId, value),
          () => this.close(peerId),
        ),
      };
      this.peers.set(peerId, peer);
      for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
      pc.onicecandidate = (event) => {
        if (!event.candidate || this.peers.get(peerId) !== peer) return;
        if (peer.early) peer.early.push(event.candidate);
        else peer.send(iceSignal(event.candidate));
      };
      pc.onconnectionstatechange = () => {
        // The viewer reconnects with a new offer; nothing to keep.
        if (pc.connectionState === "failed") this.close(peerId);
      };
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      for (const candidate of peer.pendingIce) await pc.addIceCandidate(candidate);
      peer.pendingIce = [];
      const answer = await pc.createAnswer();
      if (this.peers.get(peerId) !== peer) return;
      await pc.setLocalDescription(answer);
      peer.send({ type: "answer", sdp: pc.localDescription!.sdp });
      for (const candidate of peer.early ?? []) peer.send(iceSignal(candidate));
      peer.early = undefined;
      await this.limit(pc);
      return;
    }
    const peer = this.peers.get(peerId);
    if (!peer || signal.type !== "ice") return;
    if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
    else peer.pendingIce.push(signal.candidate);
  }

  private async limit(pc: RTCPeerConnection) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) continue;
      parameters.encodings[0]!.maxBitrate = this.maxBitrate;
      await sender.setParameters(parameters).catch(() => undefined);
    }
  }

  // Closes every viewer the API no longer lists: left, replaced by another
  // tab, silent or without access any more.
  retain(peerIds: Iterable<string>) {
    const keep = new Set(peerIds);
    for (const peerId of [...this.peers.keys()])
      if (!keep.has(peerId)) this.close(peerId);
  }

  close(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
  }

  // Closes the connections; the caller owns and stops the local tracks.
  stop() {
    this.closed = true;
    for (const peerId of [...this.peers.keys()]) this.close(peerId);
  }
}

export class ViewerTransport {
  private pc?: RTCPeerConnection;
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private readonly send: (signal: CallSignal) => void;

  constructor(
    send: (signal: CallSignal) => Promise<void>,
    private readonly stream: (stream: MediaStream) => void,
    private readonly state: (state: RTCPeerConnectionState) => void,
    failed: () => void,
  ) {
    this.send = sequence(send, () => {
      if (!this.closed) failed();
    });
  }

  get connection() {
    return this.pc;
  }

  async start(iceServers: RTCIceServer[]) {
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    // Tracks without a stream id are collected into one stream.
    let fallback: MediaStream | undefined;
    pc.ontrack = (event) => {
      if (this.closed) return;
      const [stream] = event.streams;
      if (stream) return this.stream(stream);
      fallback ??= new MediaStream();
      fallback.addTrack(event.track);
      this.stream(fallback);
    };
    pc.onconnectionstatechange = () => {
      if (!this.closed) this.state(pc.connectionState);
    };
    // Candidates found before the offer is queued wait for it.
    let early: RTCIceCandidate[] | undefined = [];
    pc.onicecandidate = (event) => {
      if (!event.candidate || this.closed) return;
      if (early) early.push(event.candidate);
      else this.send(iceSignal(event.candidate));
    };
    const offer = await pc.createOffer();
    if (this.closed) return;
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", sdp: pc.localDescription!.sdp });
    for (const candidate of early) this.send(iceSignal(candidate));
    early = undefined;
  }

  async consume(signal: CallSignal) {
    if (this.closed || !this.pc) return;
    if (signal.type === "ice") {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(signal.candidate);
      else this.pendingIce.push(signal.candidate);
      return;
    }
    if (signal.type !== "answer") return;
    await this.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    for (const candidate of this.pendingIce) await this.pc.addIceCandidate(candidate);
    this.pendingIce = [];
  }

  close() {
    this.closed = true;
    if (!this.pc) return;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}
