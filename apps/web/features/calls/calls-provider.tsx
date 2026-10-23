"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  authEndpoints,
  AuthSessionResponseSchema,
  CallNoticeSchema,
  type Call,
  type CallSignal,
  type Conversation,
} from "@instagram/contracts";
import { createApiClient } from "@/lib/api/client";
import { createCallsClient } from "@/lib/api/calls";
import { describeFailure } from "@/lib/api/messages";
import { RtcSession } from "./rtc-session";
import { CallOverlay } from "./call-overlay";

type Controls = {
  start: (conversation: Conversation, kind: "AUDIO" | "VIDEO") => void;
  busy: boolean;
};
const CallsContext = createContext<Controls | null>(null);
export const useCalls = () => useContext(CallsContext);
const live = (call?: Call) =>
  call?.status === "RINGING" || call?.status === "ACTIVE";
export function mediaError(error: unknown): string {
  if (
    error instanceof DOMException &&
    ["NotAllowedError", "SecurityError"].includes(error.name)
  )
    return "Разрешите доступ к микрофону и камере в настройках браузера.";
  if (
    error instanceof DOMException &&
    ["NotFoundError", "DevicesNotFoundError"].includes(error.name)
  )
    return "Не найден микрофон или камера. Подключите устройство и повторите.";
  if (error instanceof DOMException && error.name === "NotReadableError")
    return "Микрофон или камера заняты другим приложением.";
  return error instanceof Error
    ? error.message
    : "Не удалось установить соединение. Повторите звонок.";
}
export function CallsProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<Call>();
  const [viewerId, setViewerId] = useState<string>();
  const [local, setLocal] = useState<MediaStream>();
  const [remote, setRemote] = useState<MediaStream>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const current = useRef<Call | undefined>(undefined);
  const engine = useRef<RtcSession | undefined>(undefined);
  const owned = useRef<string | undefined>(undefined);
  const device = useRef("");
  const generation = useRef(0);
  const pending = useRef(false);
  const offered = useRef(false);
  const mediaConnected = useRef(false);
  const cursor = useRef(0);
  const preparingRef = useRef(false);
  const syncBusy = useRef(false);
  const heartbeatAt = useRef(0);
  const healthyAt = useRef(0);
  const handlers = useRef({ sync: async () => {}, watchdog: () => {} });

  function show(value?: Call) {
    const previous = current.current;
    current.current = value;
    setCall(value);
    if (previous?.id !== value?.id || previous?.status !== value?.status)
      window.dispatchEvent(new Event("instagram-call-history"));
  }
  function release() {
    generation.current += 1;
    syncBusy.current = false;
    pending.current = false;
    preparingRef.current = false;
    setPreparing(false);
    engine.current?.close();
    engine.current = undefined;
    owned.current = undefined;
    offered.current = false;
    mediaConnected.current = false;
    cursor.current = 0;
    setLocal(undefined);
    setRemote(undefined);
    setConnected(false);
  }
  async function end(action: "end" | "decline" | "fail" = "end") {
    const previous = current.current;
    const cancellingPreparation = preparingRef.current;
    release();
    preparingRef.current = false;
    setPreparing(false);
    if (!previous) return;
    show({
      ...previous,
      status:
        action === "decline"
          ? "DECLINED"
          : action === "fail"
            ? "FAILED"
            : "ENDED",
      endedAt: new Date().toISOString(),
    });
    const result = await createCallsClient().action(previous.id, {
      action,
      clientId: device.current,
    });
    if (result.ok && current.current?.id === previous.id)
      show(result.data.call);
    else if (
      !result.ok &&
      result.failure.kind !== "aborted" &&
      !(
        cancellingPreparation &&
        result.failure.kind === "api" &&
        result.failure.status === 404
      )
    )
      setError(describeFailure(result.failure));
  }
  function mediaFailed() {
    setError("Соединение прервано. Проверьте сеть и повторите звонок.");
    void end("fail");
  }
  async function prepare(kind: Call["kind"], id: string) {
    const version = generation.current;
    const client = createCallsClient(),
      config = await client.config();
    if (!config.ok) throw new Error(describeFailure(config.failure));
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error(
        "Звонки требуют современный браузер и HTTPS (локально — localhost).",
      );
    if (version !== generation.current) return false;
    const session = new RtcSession(
      async (signal: CallSignal) => {
        if (version !== generation.current) return;
        const response = await client.sendSignal(id, device.current, signal);
        if (!response.ok) throw new Error(describeFailure(response.failure));
      },
      setRemote,
      (value) => {
        mediaConnected.current = value;
        setConnected(value);
      },
      mediaFailed,
    );
    engine.current = session;
    const stream = await session.prepare(kind, config.data.iceServers);
    if (version !== generation.current) {
      session.close();
      return false;
    }
    setLocal(stream);
    owned.current = id;
    healthyAt.current = Date.now();
    heartbeatAt.current = 0;
    return true;
  }
  async function start(conversation: Conversation, kind: Call["kind"]) {
    if (pending.current || live(current.current) || !viewerId) return;
    pending.current = true;
    preparingRef.current = true;
    setPreparing(true);
    setError(undefined);
    const id = crypto.randomUUID();
    const draft: Call = {
      id,
      conversationId: conversation.id,
      callerId: viewerId,
      peer: conversation.peer,
      kind,
      status: "RINGING",
      createdAt: new Date().toISOString(),
      answeredAt: null,
      endedAt: null,
    };
    show(draft);
    const version = generation.current;
    try {
      if (!(await prepare(kind, id)) || version !== generation.current) return;
      const response = await createCallsClient().start({
        id,
        conversationId: conversation.id,
        kind,
        clientId: device.current,
      });
      if (version !== generation.current) {
        if (response.ok)
          await createCallsClient().action(id, {
            action: "end",
            clientId: device.current,
          });
        return;
      }
      if (!response.ok) throw new Error(describeFailure(response.failure));
      if (!live(response.data.call)) release();
      show(response.data.call);
    } catch (reason) {
      if (version === generation.current) {
        release();
        show(undefined);
        setError(mediaError(reason));
      }
    } finally {
      if (version === generation.current) {
        pending.current = false;
        preparingRef.current = false;
        setPreparing(false);
      }
    }
  }
  async function accept() {
    const previous = current.current;
    if (pending.current || !previous || previous.status !== "RINGING") return;
    pending.current = true;
    preparingRef.current = true;
    setPreparing(true);
    setError(undefined);
    const version = generation.current;
    try {
      if (
        !(await prepare(previous.kind, previous.id)) ||
        version !== generation.current
      )
        return;
      const response = await createCallsClient().action(previous.id, {
        action: "accept",
        clientId: device.current,
      });
      if (version !== generation.current) {
        if (response.ok)
          await createCallsClient().action(previous.id, {
            action: "end",
            clientId: device.current,
          });
        return;
      }
      if (!response.ok) throw new Error(describeFailure(response.failure));
      if (!live(response.data.call)) release();
      show(response.data.call);
    } catch (reason) {
      if (version === generation.current) {
        setError(mediaError(reason));
        await end("fail");
      }
    } finally {
      if (version === generation.current) {
        pending.current = false;
        preparingRef.current = false;
        setPreparing(false);
      }
    }
  }
  async function sync() {
    if (!viewerId || preparingRef.current || syncBusy.current) return;
    syncBusy.current = true;
    const version = generation.current;
    try {
      const client = createCallsClient(),
        result = await client.current();
      if (version !== generation.current) return;
      if (!result.ok) {
        if (
          result.failure.kind === "api" &&
          [401, 403].includes(result.failure.status)
        ) {
          release();
          show(undefined);
          setViewerId(undefined);
        } else if (owned.current && Date.now() - healthyAt.current > 15000)
          mediaFailed();
        return;
      }
      healthyAt.current = Date.now();
      let next = result.data.call;
      if (!next && live(current.current)) {
        const last = await client.get(current.current!.id);
        if (version !== generation.current) return;
        if (last.ok) next = last.data.call;
        else {
          release();
          show(undefined);
          return;
        }
      }
      if (!next) return;
      if (!live(next)) {
        release();
        show(next);
        return;
      }
      show(next);
      if (owned.current !== next.id || !engine.current) return;
      if (Date.now() - heartbeatAt.current > 5000) {
        heartbeatAt.current = Date.now();
        const heartbeat = await client.heartbeat(next.id, device.current);
        if (version !== generation.current) return;
        if (!heartbeat.ok) {
          mediaFailed();
          return;
        }
        if (!live(heartbeat.data.call)) {
          release();
          show(heartbeat.data.call);
          return;
        }
      }
      if (next.status !== "ACTIVE") return;
      if (
        !mediaConnected.current &&
        next.answeredAt &&
        Date.now() - Date.parse(next.answeredAt) > 30000
      ) {
        mediaFailed();
        return;
      }
      if (next.callerId === viewerId && !offered.current) {
        offered.current = true;
        await engine.current.offer();
      }
      const signals = await client.signals(
        next.id,
        device.current,
        cursor.current,
      );
      if (version !== generation.current) return;
      if (!signals.ok) {
        mediaFailed();
        return;
      }
      for (const item of signals.data.items) {
        await engine.current?.consume(item.signal);
        if (version !== generation.current) return;
      }
      cursor.current = signals.data.next;
    } catch {
      if (version === generation.current && owned.current) mediaFailed();
    } finally {
      if (version === generation.current) syncBusy.current = false;
    }
  }
  useEffect(() => {
    handlers.current = {
      sync,
      watchdog: () => {
        if (owned.current && Date.now() - healthyAt.current > 15000)
          mediaFailed();
      },
    };
  });
  useEffect(() => {
    let stopped = false;
    device.current = crypto.randomUUID();
    void createApiClient()
      .request(authEndpoints.session, AuthSessionResponseSchema)
      .then((result) => {
        if (!stopped && result.ok && result.data.user?.emailVerified)
          setViewerId(result.data.user.id);
      });
    return () => {
      stopped = true;
      generation.current += 1;
      engine.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!viewerId) return;
    const source = new EventSource("/api/v1/direct/events");
    const run = () => {
      handlers.current.watchdog();
      void handlers.current.sync();
    };
    source.addEventListener("ready", run);
    source.addEventListener("call", (event) => {
      try {
        if (
          CallNoticeSchema.safeParse(
            JSON.parse((event as MessageEvent<string>).data),
          ).success
        )
          run();
      } catch {
        /* Ignore malformed hints; polling repairs state. */
      }
    });
    const timer = setInterval(run, 1500);
    window.addEventListener("online", run);
    const closeMedia = () => engine.current?.close();
    window.addEventListener("pagehide", closeMedia);
    run();
    return () => {
      source.close();
      clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("pagehide", closeMedia);
    };
  }, [viewerId]);
  useEffect(() => {
    if (!call || live(call)) return;
    const timer = setTimeout(() => {
      if (current.current?.id === call.id && !live(current.current))
        show(undefined);
    }, 4000);
    return () => clearTimeout(timer);
  }, [call]);
  return (
    <CallsContext
      value={{
        start: (conversation, kind) => void start(conversation, kind),
        busy: live(call) || preparing,
      }}
    >
      {children}
      {call && (
        <CallOverlay
          key={call.id}
          call={call}
          incoming={call.callerId !== viewerId && call.status === "RINGING"}
          owned={Boolean(local)}
          preparing={preparing}
          connected={connected}
          local={local}
          remote={remote}
          error={error}
          onAccept={() => void accept()}
          onEnd={(action) => void end(action)}
          onMicrophone={(enabled) => engine.current?.microphone(enabled)}
          onCamera={(enabled) => engine.current?.camera(enabled)}
        />
      )}
      {!call && error && (
        <div
          role="alert"
          className="fixed bottom-20 left-1/2 z-[100] flex w-[min(90vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-[#232333] p-4 text-sm text-white shadow-xl"
        >
          {error}
          <button
            type="button"
            aria-label="Закрыть ошибку звонка"
            onClick={() => setError(undefined)}
          >
            ×
          </button>
        </div>
      )}
    </CallsContext>
  );
}
