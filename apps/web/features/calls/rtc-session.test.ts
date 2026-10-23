import { afterEach, describe, expect, it, vi } from "vitest";
import { RtcSession } from "./rtc-session";
const audio = () => ({ enabled: true, stop: vi.fn() });
class Peer {
  localDescription: { sdp: string } | null = null;
  remoteDescription: unknown = null;
  addTrack = vi.fn();
  addIceCandidate = vi.fn();
  close = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "local offer" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "local answer" }));
  setLocalDescription = vi.fn(async (value: { sdp: string }) => {
    this.localDescription = value;
  });
  setRemoteDescription = vi.fn(async (value: unknown) => {
    this.remoteDescription = value;
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("RTC media lifecycle", () => {
  it("buffers ICE before SDP, answers offers, mutes tracks and releases devices", async () => {
    const mic = audio(),
      camera = audio();
    const stream = {
      getTracks: () => [mic, camera],
      getAudioTracks: () => [mic],
      getVideoTracks: () => [camera],
    };
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal("RTCPeerConnection", Peer);
    const send = vi.fn(async () => {}),
      session = new RtcSession(send, vi.fn(), vi.fn(), vi.fn());
    await session.prepare("VIDEO", []);
    await session.consume({
      type: "ice",
      candidate: { candidate: "fake", sdpMid: "0", sdpMLineIndex: 0 },
    });
    expect(session.pc!.addIceCandidate).not.toHaveBeenCalled();
    await session.consume({ type: "offer", sdp: "remote offer" });
    expect(session.pc!.addIceCandidate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "answer", sdp: "local answer" });
    session.microphone(false);
    session.camera(false);
    expect(mic.enabled).toBe(false);
    expect(camera.enabled).toBe(false);
    session.microphone(true);
    expect(mic.enabled).toBe(true);
    session.close();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(session.pc!.close).toHaveBeenCalledOnce();
  });
  it("stops a device stream that arrives after cancellation", async () => {
    let resolve!: (stream: unknown) => void;
    const pending = new Promise((resolveStream) => {
      resolve = resolveStream;
    });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => pending },
    });
    const session = new RtcSession(vi.fn(), vi.fn(), vi.fn(), vi.fn());
    const prepare = session.prepare("AUDIO", []);
    session.close();
    const track = audio();
    resolve({ getTracks: () => [track] });
    expect(await prepare).toBeUndefined();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(session.pc).toBeUndefined();
  });
});
