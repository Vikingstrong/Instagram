import type { CallSignal } from "@instagram/contracts";
// Media is independent of call records/UI so a future SFU adapter can replace it.
export class RtcSession {
  pc?: RTCPeerConnection;
  local?: MediaStream;
  private closed = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private disconnected?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly send: (signal: CallSignal) => Promise<void>,
    private readonly remote: (stream: MediaStream) => void,
    private readonly state: (connected: boolean) => void,
    private readonly fail: () => void,
  ) {}
  async prepare(kind: "AUDIO" | "VIDEO", iceServers: RTCIceServer[]) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video:
        kind === "VIDEO"
          ? {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : false,
    });
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.local = stream;
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.onicecandidate = (event) => {
      if (event.candidate && !this.closed) {
        const json = event.candidate.toJSON();
        void this.send({
          type: "ice",
          candidate: {
            candidate: json.candidate ?? "",
            sdpMid: json.sdpMid ?? null,
            sdpMLineIndex: json.sdpMLineIndex ?? null,
            usernameFragment: json.usernameFragment ?? null,
          },
        }).catch(() => {
          if (!this.closed) this.fail();
        });
      }
    };
    pc.ontrack = (event) => {
      if (!this.closed)
        this.remote(event.streams[0] ?? new MediaStream([event.track]));
    };
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      clearTimeout(this.disconnected);
      this.state(pc.connectionState === "connected");
      if (pc.connectionState === "failed") this.fail();
      if (pc.connectionState === "disconnected")
        this.disconnected = setTimeout(() => this.fail(), 10000);
    };
    return stream;
  }
  async offer() {
    if (this.closed || !this.pc) return;
    await this.pc.setLocalDescription(await this.pc.createOffer());
    if (!this.closed)
      await this.send({ type: "offer", sdp: this.pc.localDescription!.sdp });
  }
  async consume(signal: CallSignal) {
    if (this.closed || !this.pc) return;
    if (signal.type === "ice") {
      if (this.pc.remoteDescription)
        await this.pc.addIceCandidate(signal.candidate);
      else this.pendingIce.push(signal.candidate);
      return;
    }
    await this.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    for (const candidate of this.pendingIce)
      await this.pc.addIceCandidate(candidate);
    this.pendingIce = [];
    if (signal.type === "offer") {
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      if (!this.closed)
        await this.send({ type: "answer", sdp: this.pc.localDescription!.sdp });
    }
  }
  microphone(enabled: boolean) {
    this.local?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }
  camera(enabled: boolean) {
    this.local?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }
  close() {
    this.closed = true;
    clearTimeout(this.disconnected);
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.close();
    }
    this.local?.getTracks().forEach((track) => track.stop());
    this.pendingIce = [];
  }
}
