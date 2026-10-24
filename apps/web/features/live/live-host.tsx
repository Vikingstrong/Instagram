"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Users, Video, VideoOff } from "lucide-react";
import { liveRules, type Live, type UserSummary } from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";
import { mediaError } from "@/features/calls/calls-provider";
import { createLivesClient } from "@/lib/api/lives";
import { describeFailure } from "@/lib/api/messages";
import { cn } from "@/lib/utils";

import { GiftEffects } from "./gift-effects";
import { LiveChat } from "./live-chat";
import { useLiveNotices } from "./live-notices";
import { LiveStage, StreamVideo, roundButton } from "./live-stage";
import { HostTransport } from "./live-transport";

type Phase =
  | { state: "checking" }
  // Another tab or device of this account is on air.
  | { state: "other"; live: Live }
  | { state: "setup" }
  | { state: "starting" }
  | { state: "live"; live: Live }
  | { state: "ended"; live?: Live; message?: string };
type Devices = { cameras: MediaDeviceInfo[]; microphones: MediaDeviceInfo[] };

const stopTracks = (stream?: MediaStream) =>
  stream?.getTracks().forEach((track) => track.stop());

export function duration(from: string, to: number) {
  const seconds = Math.max(0, Math.floor((to - Date.parse(from)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

// FR-12 host: choose devices and preview ("готовится"), go live, see the
// viewers and the chat, end the stream. Leaving the page ends it too; a
// closed tab ends on the server when its heartbeat stops.
export function LiveHost() {
  const identity = useHomeIdentity();
  const checking = useHomeChecking();
  // A brief session recheck hides the identity; the stream must go on.
  const [viewer, setViewer] = useState(identity);
  if (identity && identity.id !== viewer?.id) setViewer(identity);
  const viewerId = viewer?.id;
  const [phase, setPhase] = useState<Phase>({ state: "checking" });
  const [stream, setStream] = useState<MediaStream>();
  const [devices, setDevices] = useState<Devices>({ cameras: [], microphones: [] });
  const [camera, setCamera] = useState("");
  const [microphone, setMicrophone] = useState("");
  const [deviceError, setDeviceError] = useState<string>();
  const [error, setError] = useState<string>();
  const [viewers, setViewers] = useState<UserSummary[]>([]);
  const [showViewers, setShowViewers] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [now, setNow] = useState(Date.now);
  const local = useRef<MediaStream | undefined>(undefined);
  const transport = useRef<HostTransport | undefined>(undefined);
  const liveId = useRef<string | undefined>(undefined);
  const device = useRef("");
  const cursor = useRef(0);
  const busy = useRef(false);
  const heartbeatAt = useRef(0);
  const healthyAt = useRef(0);
  const capturing = useRef(0);
  const mounted = useRef(true);
  const handlers = useRef({ sync: async () => {}, capture: async () => {} });

  async function capture(cameraId?: string, microphoneId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setDeviceError("Эфиры требуют современный браузер и HTTPS (локально — localhost).");
      return;
    }
    const version = ++capturing.current;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "user" }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
      });
      // A late result after a newer choice or after leaving is dropped.
      if (version !== capturing.current || !mounted.current) {
        stopTracks(next);
        return;
      }
      stopTracks(local.current);
      local.current = next;
      setStream(next);
      setMicOn(true);
      setCameraOn(true);
      setCamera(next.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      setMicrophone(next.getAudioTracks()[0]?.getSettings().deviceId ?? "");
      setDeviceError(undefined);
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      setDevices({
        cameras: all.filter((item) => item.kind === "videoinput" && item.deviceId),
        microphones: all.filter((item) => item.kind === "audioinput" && item.deviceId),
      });
    } catch (reason) {
      if (version === capturing.current) setDeviceError(mediaError(reason));
    }
  }

  function finish(live?: Live, message?: string) {
    transport.current?.stop();
    transport.current = undefined;
    liveId.current = undefined;
    capturing.current += 1;
    stopTracks(local.current);
    local.current = undefined;
    setStream(undefined);
    setViewers([]);
    setPhase({ state: "ended", live, message });
  }

  function check() {
    return createLivesClient()
      .current()
      .then((result) => {
        if (!mounted.current) return;
        if (result.ok && result.data.live)
          setPhase({ state: "other", live: result.data.live });
        else {
          if (!result.ok) setError(describeFailure(result.failure));
          setPhase({ state: "setup" });
        }
      });
  }

  async function goLive() {
    const media = local.current;
    if (!media) return;
    setPhase({ state: "starting" });
    setError(undefined);
    const client = createLivesClient();
    const config = await client.config();
    if (!mounted.current) return;
    if (!config.ok) {
      setError(describeFailure(config.failure));
      setPhase({ state: "setup" });
      return;
    }
    const id = crypto.randomUUID();
    const started = await client.start({ id, clientId: device.current });
    if (!mounted.current) {
      if (started.ok) void client.end(id);
      return;
    }
    if (!started.ok) {
      setError(describeFailure(started.failure));
      if (started.failure.kind === "api" && started.failure.error.code === "LIVE_BUSY")
        void check();
      else setPhase({ state: "setup" });
      return;
    }
    transport.current = new HostTransport(
      media,
      config.data.iceServers,
      async (peerId, signal) => {
        const sent = await client.sendSignal(id, device.current, peerId, signal);
        if (!sent.ok) throw new Error(describeFailure(sent.failure));
      },
    );
    liveId.current = id;
    cursor.current = 0;
    heartbeatAt.current = Date.now();
    healthyAt.current = Date.now();
    setPhase({ state: "live", live: started.data.live });
  }

  async function end() {
    const id = liveId.current;
    if (!id) return;
    const before = phase.state === "live" ? phase.live : undefined;
    liveId.current = undefined;
    const result = await createLivesClient().end(id);
    if (!mounted.current) return;
    finish(
      result.ok ? result.data.live : before,
      result.ok ? undefined : "Не удалось связаться с сервером: эфир завершится автоматически.",
    );
  }

  async function sync() {
    const id = liveId.current,
      engine = transport.current;
    if (!id || !engine || busy.current) return;
    busy.current = true;
    const client = createLivesClient();
    try {
      if (Date.now() - heartbeatAt.current > 5000) {
        heartbeatAt.current = Date.now();
        const beat = await client.heartbeat(id, device.current);
        if (liveId.current !== id) return;
        if (!beat.ok) {
          // The server ends a silent stream after 20 s; stop before that.
          if (beat.failure.kind === "api" || Date.now() - healthyAt.current > 15000)
            finish(undefined, "Эфир прерван: нет связи с сервером.");
          return;
        }
        healthyAt.current = Date.now();
        if (beat.data.live.status === "ENDED") {
          finish(beat.data.live);
          return;
        }
        setPhase({ state: "live", live: beat.data.live });
      }
      const result = await client.signals(id, device.current, cursor.current);
      if (liveId.current !== id) return;
      if (!result.ok) {
        if (result.failure.kind === "api" && result.failure.error.code === "LIVE_ENDED")
          finish();
        return;
      }
      for (const item of result.data.items)
        await engine.consume(item.peerId, item.signal).catch(() => engine.close(item.peerId));
      engine.retain(result.data.peers.map((peer) => peer.peerId));
      cursor.current = result.data.next;
      setViewers(result.data.peers.map((peer) => peer.user));
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    handlers.current = { sync, capture: () => capture() };
  });

  useEffect(() => {
    mounted.current = true;
    device.current = crypto.randomUUID();
    return () => {
      mounted.current = false;
      capturing.current += 1;
      transport.current?.stop();
      stopTracks(local.current);
      // Leaving the page ends the stream for every viewer.
      if (liveId.current) void createLivesClient().end(liveId.current);
    };
  }, []);
  useEffect(() => {
    if (viewerId) void check();
  }, [viewerId]);
  useEffect(() => {
    if (phase.state === "setup" && !local.current) void handlers.current.capture();
  }, [phase.state]);
  useEffect(() => {
    if (phase.state !== "live") return;
    const run = () => void handlers.current.sync();
    const timer = setInterval(run, 1500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    window.addEventListener("online", run);
    run();
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("online", run);
    };
  }, [phase.state]);
  useLiveNotices((id) => {
    if (id === liveId.current) void handlers.current.sync();
  });

  if (!viewer)
    return checking ? null : (
      <Panel title="Прямой эфир">
        <Link href="/auth/login" className="text-sm font-semibold text-ig-link">
          Войдите, чтобы начать эфир
        </Link>
      </Panel>
    );
  const self: UserSummary = {
    id: viewer.id,
    username: viewer.username,
    displayName: "",
    avatarUrl: null,
    isPrivate: false,
  };

  if (phase.state === "checking")
    return (
      <p role="status" className="m-auto text-sm text-muted-foreground">
        Проверяем эфиры…
      </p>
    );
  if (phase.state === "other")
    return (
      <Panel title="У вас уже идёт эфир">
        <p className="text-sm text-muted-foreground">
          Эфир с {new Date(phase.live.startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{" "}
          открыт в другой вкладке или на другом устройстве. Завершите его, чтобы начать новый.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button
          type="button"
          onClick={async () => {
            const result = await createLivesClient().end(phase.live.id);
            if (result.ok) setPhase({ state: "setup" });
            else setError(describeFailure(result.failure));
          }}
          className="h-9 rounded-lg bg-ig-blue px-4 text-sm font-semibold text-white"
        >
          Завершить тот эфир
        </button>
      </Panel>
    );
  if (phase.state === "ended")
    return (
      <Panel title="Эфир завершён">
        {phase.live && (
          <p className="text-sm text-muted-foreground">
            Длительность {duration(phase.live.startedAt, Date.parse(phase.live.endedAt ?? new Date().toISOString()))}.
            Эфиры не записываются: видео и чат больше недоступны.
          </p>
        )}
        {phase.message && <p role="alert" className="text-sm text-destructive">{phase.message}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPhase({ state: "setup" })}
            className="h-9 rounded-lg bg-ig-blue px-4 text-sm font-semibold text-white"
          >
            Новый эфир
          </button>
          <Link href="/" className="inline-flex h-9 items-center rounded-lg bg-secondary px-4 text-sm font-semibold">
            На главную
          </Link>
        </div>
      </Panel>
    );

  const onAir = phase.state === "live";
  const live = onAir ? phase.live : undefined;
  const toggleMic = () => {
    const next = !micOn;
    local.current?.getAudioTracks().forEach((track) => (track.enabled = next));
    setMicOn(next);
  };
  const toggleCamera = () => {
    const next = !cameraOn;
    local.current?.getVideoTracks().forEach((track) => (track.enabled = next));
    setCameraOn(next);
  };

  return (
    <LiveStage
      host={live?.host ?? self}
      onAir={onAir}
      viewerCount={viewers.length}
      video={<StreamVideo stream={stream} muted mirrored label="Ваша камера" />}
      overlay={live && <GiftEffects liveId={live.id} open />}
      status={
        !stream && (
          <>
            {deviceError ? (
              <>
                <p role="alert" className="text-sm">{deviceError}</p>
                <button type="button" onClick={() => void capture()} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold">
                  Повторить
                </button>
              </>
            ) : (
              <p role="status" className="text-sm text-white/75">Включаем камеру и микрофон…</p>
            )}
          </>
        )
      }
      actions={
        stream && (
          <>
            <button type="button" onClick={toggleMic} aria-label={micOn ? "Выключить микрофон" : "Включить микрофон"} className={cn(roundButton, !micOn && "bg-white text-black")}>
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button type="button" onClick={toggleCamera} aria-label={cameraOn ? "Выключить камеру" : "Включить камеру"} className={cn(roundButton, !cameraOn && "bg-white text-black")}>
              {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
            {onAir ? (
              <>
                <button type="button" onClick={() => setShowViewers((value) => !value)} aria-expanded={showViewers} aria-label="Зрители" className={roundButton}>
                  <Users size={20} />
                </button>
                <button type="button" onClick={() => void end()} className="h-11 rounded-full bg-[#ff3040] px-5 text-sm font-semibold text-white">
                  Завершить
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void goLive()}
                disabled={phase.state === "starting"}
                className="h-11 rounded-full bg-linear-to-r from-[#d300c5] to-[#ff0069] px-5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {phase.state === "starting" ? "Подключаем…" : "Начать эфир"}
              </button>
            )}
          </>
        )
      }
      chat={
        live ? (
          <div className="relative flex flex-col md:w-80">
            <p role="status" className="px-4 pb-2 text-center text-xs text-muted-foreground md:text-left">
              В эфире {duration(live.startedAt, now)} · до {liveRules.maxViewers} зрителей
            </p>
            {showViewers && <ViewerList viewers={viewers} />}
            <LiveChat liveId={live.id} open />
          </div>
        ) : (
          <Settings
            devices={devices}
            camera={camera}
            microphone={microphone}
            disabled={phase.state === "starting"}
            error={error}
            onCamera={(id) => void capture(id, microphone || undefined)}
            onMicrophone={(id) => void capture(camera || undefined, id)}
          />
        )
      }
    />
  );
}

function ViewerList({ viewers }: { viewers: UserSummary[] }) {
  return (
    <section aria-label="Список зрителей" className="mx-3 mb-3 rounded-xl border p-3 md:mx-0">
      <h2 className="mb-2 text-sm font-semibold">Зрители · {viewers.length}</h2>
      {viewers.length === 0 ? (
        <p className="text-xs text-muted-foreground">Пока никто не подключился.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {viewers.map((user) => (
            <li key={user.id} className="flex items-center gap-2 text-sm">
              <Avatar name={user.username} src={user.avatarUrl} size={24} />
              {user.username}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Settings({
  devices,
  camera,
  microphone,
  disabled,
  error,
  onCamera,
  onMicrophone,
}: {
  devices: Devices;
  camera: string;
  microphone: string;
  disabled: boolean;
  error?: string;
  onCamera: (id: string) => void;
  onMicrophone: (id: string) => void;
}) {
  const select =
    "h-9 w-full rounded-lg border bg-background px-3 text-sm disabled:opacity-60";
  return (
    <section aria-label="Настройки эфира" className="flex flex-col gap-4 px-4 pb-6 md:w-80 md:px-0">
      <div>
        <h1 className="text-lg font-semibold">Прямой эфир</h1>
        <p className="text-sm text-muted-foreground">
          Смотреть и комментировать смогут те, кто видит ваши публикации. Эфир не
          записывается; до {liveRules.maxViewers} зрителей одновременно, до{" "}
          {liveRules.maxDurationMinutes} минут.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Камера
        <select value={camera} disabled={disabled || !devices.cameras.length} onChange={(event) => onCamera(event.target.value)} className={select}>
          {devices.cameras.map((item, index) => (
            <option key={item.deviceId} value={item.deviceId}>
              {item.label || `Камера ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Микрофон
        <select value={microphone} disabled={disabled || !devices.microphones.length} onChange={(event) => onMicrophone(event.target.value)} className={select}>
          {devices.microphones.map((item, index) => (
            <option key={item.deviceId} value={item.deviceId}>
              {item.label || `Микрофон ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="m-auto flex max-w-100 flex-col items-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </section>
  );
}
