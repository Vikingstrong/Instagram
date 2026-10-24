import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrivateAudio } from "./private-audio";
import { AttachmentComposer } from "./attachment-composer";
import { useVoiceRecorder } from "./use-voice-recorder";

const stopTrack = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;
class FakeRecorder {
  static isTypeSupported = () => true;
  static latest: FakeRecorder;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() {
    FakeRecorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["synthetic audio"], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  stopTrack.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("records only after a click, stops tracks and produces a voice file", async () => {
  const received = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(received));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  await act(() => result.current.start());
  expect(result.current.state).toBe("recording");
  act(() => result.current.stop());
  expect(result.current.state).toBe("idle");
  expect(received).toHaveBeenCalledOnce();
  expect(received.mock.calls[0]![0]).toBeInstanceOf(File);
  expect(stopTrack).toHaveBeenCalled();
});
it("cancels recording without creating an outgoing file", async () => {
  const received = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(received));
  await act(() => result.current.start());
  act(() => result.current.cancel());
  expect(received).not.toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalled();
});
it("releases a microphone granted after navigation and never publishes the late result", async () => {
  let grant!: (value: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
    new Promise((resolve) => {
      grant = resolve;
    }),
  );
  const received = vi.fn();
  const { result, unmount } = renderHook(() => useVoiceRecorder(received));
  let started!: Promise<void>;
  act(() => {
    started = result.current.start();
  });
  unmount();
  await act(async () => {
    grant(stream);
    await started;
  });
  expect(stopTrack).toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});
it("reports denied permission and permits another attempt", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  const { result } = renderHook(() => useVoiceRecorder(vi.fn()));
  await act(() => result.current.start());
  expect(result.current.error).toMatch(/разрешение/);
  expect(result.current.state).toBe("idle");
  await act(() => result.current.start());
  expect(result.current.state).toBe("recording");
});
it("automatically stops a recording at the duration limit", async () => {
  vi.useFakeTimers();
  const received = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(received));
  await act(() => result.current.start());
  act(() => {
    vi.advanceTimersByTime(180_000);
  });
  expect(result.current.state).toBe("idle");
  expect(received).toHaveBeenCalledOnce();
  expect(stopTrack).toHaveBeenCalled();
});
it("previews a GIF, allows removing it, and queues the exact file without a caption", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:direct-preview");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const send = vi.fn();
  render(<AttachmentComposer onSend={send} />);
  const file = new File(["GIF89a"], "a.gif", { type: "image/gif" });
  // Native change so the navigator stub need not implement clipboard.
  fireEvent.change(screen.getByLabelText("Фото или GIF в сообщение"), {
    target: { files: [file] },
  });
  expect(screen.getByAltText("Превью сообщения")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Убрать вложение" }));
  expect(screen.queryByAltText("Превью сообщения")).toBeNull();
  fireEvent.change(screen.getByLabelText("Фото или GIF в сообщение"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith("", { file, type: "image" }),
  );
  expect(revoke).toHaveBeenCalledWith("blob:direct-preview");
});
it("rejects an invalid photo before queuing and exposes the recorder preview before send", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const send = vi.fn();
  render(<AttachmentComposer onSend={send} />);
  fireEvent.change(screen.getByLabelText("Фото или GIF в сообщение"), {
    target: { files: [new File(["x"], "bad.svg", { type: "image/svg+xml" })] },
  });
  expect(screen.getByRole("alert").textContent).toMatch(/10 МБ/);
  fireEvent.click(screen.getByRole("button", { name: "Записать голосовое" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Остановить" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
  expect(screen.getByLabelText("Прослушать запись")).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
  expect(send.mock.calls[0]![1].type).toBe("voice");
});

it("stops an active microphone on unmount without queuing a voice message", async () => {
  const received = vi.fn();
  const { result, unmount } = renderHook(() => useVoiceRecorder(received));
  await act(() => result.current.start());
  unmount();
  expect(stopTrack).toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});
it("explains unsupported recording instead of accessing the microphone", async () => {
  vi.stubGlobal("MediaRecorder", undefined);
  const { result } = renderHook(() => useVoiceRecorder(vi.fn()));
  await act(() => result.current.start());
  expect(result.current.error).toMatch(/HTTPS/);
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

it("discards a failed recorder and permits a fresh recording without stale callbacks", async () => {
  const received = vi.fn();
  const { result } = renderHook(() => useVoiceRecorder(received));
  await act(() => result.current.start());
  const previous = FakeRecorder.latest;
  act(() => previous.onerror?.());
  expect(result.current.error).toMatch(/прервана/);
  expect(result.current.state).toBe("idle");
  expect(received).not.toHaveBeenCalled();
  await act(() => result.current.start());
  act(() => previous.onstop?.());
  expect(result.current.state).toBe("recording");
  act(() => result.current.stop());
  expect(received).toHaveBeenCalledOnce();
});

it("pauses private audio and releases its request on navigation", () => {
  const { unmount } = render(
    <PrivateAudio src="blob:private-voice" label="Private voice" />,
  );
  const audio = screen.getByLabelText("Private voice") as HTMLAudioElement;
  Object.defineProperties(audio, {
    paused: { value: false },
    networkState: { value: 2 },
  });
  const pause = vi.spyOn(audio, "pause").mockImplementation(() => {});
  const load = vi.spyOn(audio, "load").mockImplementation(() => {});
  unmount();
  expect(pause).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledOnce();
  expect(audio.getAttribute("src")).toBeNull();
});
it("cleans the old audio without clearing the replacement sources", () => {
  const { rerender } = render(
    <PrivateAudio src="/old.m4a" opusUrl="/old.webm" label="Private voice" />,
  );
  const old = screen.getByLabelText("Private voice") as HTMLAudioElement;
  Object.defineProperties(old, {
    paused: { value: false },
    networkState: { value: 2 },
  });
  const pause = vi.spyOn(old, "pause").mockImplementation(() => {});
  vi.spyOn(old, "load").mockImplementation(() => {});
  rerender(
    <PrivateAudio src="/new.m4a" opusUrl="/new.webm" label="Private voice" />,
  );
  const current = screen.getByLabelText("Private voice");
  expect(current).not.toBe(old);
  expect(pause).toHaveBeenCalledOnce();
  expect(old.querySelector("source")?.getAttribute("src")).toBeNull();
  expect(current.querySelector("source")?.getAttribute("src")).toBe(
    "/new.webm",
  );
});

it("restores voice sources after Strict Mode effect replay", () => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  render(
    <StrictMode>
      <PrivateAudio
        src="/private.m4a"
        opusUrl="/private.webm"
        label="Strict voice"
      />
    </StrictMode>,
  );
  const audio = screen.getByLabelText("Strict voice");
  expect(
    Array.from(audio.querySelectorAll("source"), (node) =>
      node.getAttribute("src"),
    ),
  ).toEqual(["/private.webm", "/private.m4a"]);
});
