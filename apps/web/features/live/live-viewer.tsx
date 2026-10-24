"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Volume2 } from "lucide-react";

import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";

import { LiveChat } from "./live-chat";
import { useLiveNotices } from "./live-notices";
import { LiveStage, StreamVideo, roundButton } from "./live-stage";
import { ViewerSession, type ViewerPhase } from "./viewer-session";

// The stream id is read on the client: watching needs the session.
export function LiveViewerRoute() {
  const { id } = useParams<{ id: string }>();
  return <LiveViewer key={id} id={id} />;
}

// FR-12 viewer screen; the connection itself is in ViewerSession.
export function LiveViewer({ id }: { id: string }) {
  const viewer = useHomeIdentity();
  const checking = useHomeChecking();
  const viewerId = viewer?.id;
  const router = useRouter();
  const [phase, setPhase] = useState<ViewerPhase>({ state: "loading" });
  const [stream, setStream] = useState<MediaStream>();
  const [muted, setMuted] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const session = useRef<ViewerSession | undefined>(undefined);

  useEffect(() => {
    if (!viewerId) return;
    const current = new ViewerSession(id, viewerId, {
      phase: setPhase,
      stream: setStream,
      own: () => router.replace("/live"),
    });
    session.current = current;
    void current.open();
    const run = () => void current.sync();
    const timer = setInterval(run, 1500);
    window.addEventListener("online", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", run);
      current.dispose();
    };
  }, [id, viewerId, router]);
  useLiveNotices((liveId) => {
    if (liveId === id) void session.current?.sync();
  });
  if (phase.state === "watching" && phase.connected && !everConnected)
    setEverConnected(true);

  if (!viewer && !checking && phase.state === "loading")
    return <Notice title="Прямой эфир">Войдите, чтобы смотреть эфиры.</Notice>;
  if (phase.state === "loading")
    return (
      <p role="status" className="m-auto text-sm text-muted-foreground">
        Открываем эфир…
      </p>
    );
  if (phase.state === "unavailable")
    return (
      <Notice title="Эфир недоступен">
        Возможно, он уже закончился или автор ограничил доступ.
      </Notice>
    );
  if (phase.state === "error")
    return (
      <Notice title="Не удалось открыть эфир">
        {phase.message}{" "}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="font-semibold text-ig-link"
        >
          Повторить
        </button>
      </Notice>
    );

  const live = phase.live;
  const onAir = live.status === "LIVE" && phase.state !== "ended";
  return (
    <LiveStage
      host={live.host}
      onAir={onAir}
      viewerCount={live.viewerCount}
      video={
        <StreamVideo
          stream={stream}
          muted={muted}
          label={`Эфир ${live.host.username}`}
          onBlocked={() => setMuted(true)}
        />
      }
      status={
        phase.state === "ended" ? (
          <>
            <p className="text-lg font-semibold">Эфир завершён</p>
            <Link
              href={`/${live.host.username}`}
              className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold"
            >
              Профиль {live.host.username}
            </Link>
          </>
        ) : phase.state === "full" ? (
          <>
            <p className="text-sm">В эфире уже максимум зрителей.</p>
            <button
              type="button"
              onClick={() => void session.current?.connect()}
              className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold"
            >
              Попробовать снова
            </button>
          </>
        ) : !phase.connected ? (
          <p role="status" className="rounded-lg bg-black/40 px-3 py-1.5 text-sm">
            {everConnected ? "Переподключаемся…" : "Подключаемся к эфиру…"}
          </p>
        ) : undefined
      }
      actions={
        phase.state === "watching" &&
        muted && (
          <button
            type="button"
            onClick={() => setMuted(false)}
            aria-label="Включить звук"
            className={roundButton}
          >
            <Volume2 size={20} />
          </button>
        )
      }
      chat={<LiveChat liveId={id} open={onAir} />}
    />
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="m-auto flex max-w-100 flex-col items-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link href="/" className="text-sm font-semibold text-ig-link">
        На главную
      </Link>
    </section>
  );
}
