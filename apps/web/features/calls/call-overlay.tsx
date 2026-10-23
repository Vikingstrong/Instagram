"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Phone,
  PhoneOff,
  Minimize2,
  Maximize2,
} from "lucide-react";
import type { Call } from "@instagram/contracts";
import { Avatar } from "@/components/ui-ig/avatar";
import { cn } from "@/lib/utils";
export function CallOverlay({
  call,
  incoming,
  owned,
  preparing,
  connected,
  local,
  remote,
  error,
  onAccept,
  onEnd,
  onMicrophone,
  onCamera,
}: {
  call: Call;
  incoming: boolean;
  owned: boolean;
  preparing: boolean;
  connected: boolean;
  local?: MediaStream;
  remote?: MediaStream;
  error?: string;
  onAccept: () => void;
  onEnd: (action: "end" | "decline") => void;
  onMicrophone: (enabled: boolean) => void;
  onCamera: (enabled: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const output = useRef<HTMLVideoElement>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const [mic, setMic] = useState(true),
    [camera, setCamera] = useState(true),
    [sound, setSound] = useState(true);
  const [minimized, setMinimized] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [now, setNow] = useState(Date.now);
  const ended = !["RINGING", "ACTIVE"].includes(call.status);
  useEffect(() => {
    if (minimized) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [minimized]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const node = output.current;
    if (!node) return;
    node.srcObject = remote ?? null;
    if (remote) void node.play().catch(() => setBlocked(true));
    return () => {
      node.srcObject = null;
    };
  }, [remote]);
  useEffect(() => {
    const node = preview.current;
    if (!node) return;
    node.srcObject = local ?? null;
    if (local) void node.play().catch(() => undefined);
    return () => {
      node.srcObject = null;
    };
  }, [local]);
  const elapsed = Math.max(
    0,
    Math.floor((now - Date.parse(call.answeredAt ?? call.createdAt)) / 1000),
  );
  const duration = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const status = ended
    ? (
        {
          ENDED: "Звонок завершён",
          DECLINED: "Вызов отклонён",
          MISSED: "Нет ответа",
          FAILED: "Соединение прервано",
        } as Record<string, string>
      )[call.status]
    : preparing
      ? "Подключаем устройства…"
      : incoming
        ? `Входящий ${call.kind === "VIDEO" ? "видеозвонок" : "аудиозвонок"}`
        : connected
          ? duration
          : call.status === "RINGING"
            ? "Вызываем…"
            : owned
              ? "Устанавливаем соединение…"
              : "Звонок на другом устройстве";
  return (
    <>
      {minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="fixed right-4 bottom-20 z-[90] flex items-center gap-3 rounded-2xl border border-white/15 bg-[#202134] px-4 py-3 text-white shadow-2xl"
        >
          <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-left text-sm">
            <b className="block">
              {call.peer.displayName || call.peer.username}
            </b>
            <span className="text-xs text-white/60">{status}</span>
          </span>
          <Maximize2 size={18} />
        </button>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="call-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!incoming) setMinimized(true);
        }}
        className="fixed inset-0 m-auto h-[min(860px,100dvh)] max-h-dvh w-full max-w-5xl overflow-hidden border border-white/10 bg-[#111320] p-0 text-white shadow-2xl backdrop:bg-black/80 sm:h-[min(780px,92dvh)] sm:w-[94vw] sm:rounded-[2rem]"
      >
        <div className="relative flex h-full min-h-[min(560px,100dvh)] flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#45406b_0%,#1b2038_40%,#10131e_100%)]">
          <video
            ref={output}
            autoPlay
            playsInline
            muted={!sound}
            aria-label="Видео собеседника"
            className={cn(
              "absolute inset-0 size-full object-contain",
              (!remote || call.kind === "AUDIO") && "opacity-0",
            )}
          />
          <div className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/35 to-transparent px-5 py-5 sm:px-8">
            <span className="text-xs font-medium tracking-[0.18em] text-white/65">
              INSTAGRAM · {call.kind === "VIDEO" ? "ВИДЕО" : "АУДИО"}
            </span>
            <button
              type="button"
              aria-label="Свернуть звонок"
              onClick={() => setMinimized(true)}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
            >
              <Minimize2 size={18} />
            </button>
          </div>
          <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            {(!remote || call.kind === "AUDIO") && (
              <div className="relative mb-7">
                <span
                  className={cn(
                    "absolute -inset-5 rounded-full border border-white/10",
                    !ended && !connected && "animate-pulse",
                  )}
                />
                <span className="absolute -inset-10 rounded-full border border-white/5" />
                <div className="relative rounded-full bg-white/10 p-2 shadow-[0_0_70px_#a78bfa35]">
                  <Avatar
                    name={call.peer.username}
                    src={call.peer.avatarUrl}
                    size={96}
                  />
                </div>
              </div>
            )}
            <h2
              id="call-title"
              className={cn(
                "max-w-full truncate text-3xl font-semibold tracking-tight sm:text-4xl",
                remote &&
                  call.kind === "VIDEO" &&
                  "absolute top-0 left-5 max-w-[calc(100%-9rem)] rounded-xl bg-black/35 px-3 py-2 text-left text-lg backdrop-blur-md",
              )}
            >
              {call.peer.displayName || call.peer.username}
            </h2>
            <p
              role="status"
              className={cn(
                "mt-3 rounded-lg bg-black/10 px-3 py-1 text-sm text-white/75",
                remote &&
                  call.kind === "VIDEO" &&
                  "absolute top-12 left-5 mt-0",
              )}
            >
              {status}
            </p>
            {error && (
              <p
                role="alert"
                className="mt-3 max-w-md rounded-xl bg-black/45 px-4 py-3 text-sm text-rose-200"
              >
                {error}
              </p>
            )}
            {blocked && (
              <button
                type="button"
                className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
                onClick={() =>
                  void output.current
                    ?.play()
                    .then(() => setBlocked(false))
                    .catch(() => setBlocked(true))
                }
              >
                Включить звук собеседника
              </button>
            )}
          </div>
          {call.kind === "VIDEO" && (
            <div className="absolute top-20 right-4 h-32 w-24 overflow-hidden rounded-2xl border border-white/20 bg-[#272b3e] shadow-xl sm:right-6 sm:h-44 sm:w-32">
              <video
                ref={preview}
                autoPlay
                muted
                playsInline
                aria-label="Ваше видео"
                className={cn(
                  "size-full -scale-x-100 object-cover",
                  !camera && "invisible",
                )}
              />
              {!camera && (
                <VideoOff className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/60" />
              )}
              <span className="absolute bottom-2 left-2 rounded-md bg-black/40 px-2 py-0.5 text-xs">
                Вы
              </span>
            </div>
          )}
          <div className="relative z-10 bg-gradient-to-t from-black/55 to-transparent px-3 pt-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:px-8">
            {incoming && !ended ? (
              <div className="flex justify-center gap-12">
                <Control
                  label="Отклонить"
                  destructive
                  onClick={() => onEnd("decline")}
                >
                  <PhoneOff />
                </Control>
                <Control
                  label={preparing ? "Подключаем…" : "Принять"}
                  disabled={preparing}
                  positive
                  onClick={onAccept}
                >
                  {call.kind === "VIDEO" ? <Video /> : <Phone />}
                </Control>
              </div>
            ) : (
              !ended && (
                <div className="flex flex-wrap justify-center gap-4 sm:gap-7">
                  {owned && (
                    <>
                      <Control
                        label={mic ? "Выключить микрофон" : "Включить микрофон"}
                        pressed={!mic}
                        onClick={() => {
                          onMicrophone(!mic);
                          setMic(!mic);
                        }}
                      >
                        {mic ? <Mic /> : <MicOff />}
                      </Control>
                      {call.kind === "VIDEO" && (
                        <Control
                          label={
                            camera ? "Выключить камеру" : "Включить камеру"
                          }
                          pressed={!camera}
                          onClick={() => {
                            onCamera(!camera);
                            setCamera(!camera);
                          }}
                        >
                          {camera ? <Video /> : <VideoOff />}
                        </Control>
                      )}
                      <Control
                        label={
                          sound
                            ? "Выключить звук собеседника"
                            : "Включить звук собеседника"
                        }
                        pressed={!sound}
                        onClick={() => setSound(!sound)}
                      >
                        {sound ? <Volume2 /> : <VolumeX />}
                      </Control>
                    </>
                  )}
                  <Control
                    label="Завершить звонок"
                    destructive
                    onClick={() => onEnd("end")}
                  >
                    <PhoneOff />
                  </Control>
                </div>
              )
            )}
            <p className="mt-6 text-center text-[11px] text-white/40">
              {ended
                ? "Можно начать новый звонок в диалоге"
                : "Звук собеседника отключается только на вашем устройстве"}
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
function Control({
  label,
  children,
  onClick,
  destructive,
  positive,
  pressed,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  positive?: boolean;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="flex w-16 flex-col items-center gap-2 text-center disabled:opacity-50"
    >
      <span
        className={cn(
          "grid size-13 place-items-center rounded-full border border-white/10 bg-white/10 shadow-lg backdrop-blur-md transition hover:bg-white/20 sm:size-15",
          pressed && "bg-white text-[#171b2a] hover:bg-white/90",
          destructive && "border-rose-500 bg-rose-500 hover:bg-rose-400",
          positive && "border-emerald-500 bg-emerald-500 hover:bg-emerald-400",
        )}
      >
        {children}
      </span>
      <span className="text-[10px] leading-tight text-white/75">{label}</span>
    </button>
  );
}
