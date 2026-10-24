"use client";
import { ConfirmDialog, openModal } from "@/components/ui-ig/confirm-dialog";
import { MediaImage } from "@/components/ui-ig/media-image";
import Link from "next/link";
import { ShareButton } from "@/features/sharing/share-button";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  storyRules,
  type Story,
  type StoryViewers,
} from "@instagram/contracts";
import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeIdentity } from "@/features/auth/home-access";
import { createStoriesClient } from "@/lib/api/stories";
import { describeFailure } from "@/lib/api/messages";

export function StoryViewer({ byUser = false }: { byUser?: boolean }) {
  const { id } = useParams<{ id: string }>();
  return <Viewer key={`${id}-${byUser}`} id={id} byUser={byUser} />;
}
function Viewer({ id, byUser }: { id: string; byUser: boolean }) {
  const user = useHomeIdentity();
  const router = useRouter();
  const userId = user?.id;
  const [story, setStory] = useState<Story>();
  const [siblings, setSiblings] = useState<Story[]>([]);
  const [error, setError] = useState<string>();
  const [sharingOpen, setSharingOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [holding, setHolding] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playbackError, setPlaybackError] = useState<string>();
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audience, setAudience] = useState<StoryViewers>();
  const [audienceError, setAudienceError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const media = useRef<HTMLVideoElement>(null);
  const audienceDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (audienceOpen) openModal(audienceDialog.current);
  }, [audienceOpen]);
  const viewed = useRef(false);
  const moving = useRef(false);
  const imageElapsed = useRef(0);
  const stopped =
    paused ||
    holding ||
    hidden ||
    audienceOpen ||
    sharingOpen ||
    deleting ||
    !ready ||
    siblings.length === 0;

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const api = createStoriesClient();
    async function load() {
      let authorId = id;
      if (!byUser) {
        const first = await api.get(id, controller.signal);
        if (controller.signal.aborted) return;
        if (!first.ok) {
          setError(describeFailure(first.failure));
          return;
        }
        authorId = first.data.story.author.id;
        setStory(first.data.story);
      }
      const all: Story[] = [];
      let cursor: string | undefined;
      do {
        const result = await api.byUser(authorId, cursor, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setError(describeFailure(result.failure));
          return;
        }
        all.push(...result.data.items);
        cursor = result.data.nextCursor ?? undefined;
      } while (cursor);
      setSiblings(all);
      if (byUser) {
        const first =
          all.find((s) => s.status === "ready" && !s.viewed) ?? all[0];
        if (first) router.replace(`/stories/${first.id}`);
        else setError("Сейчас нет доступных историй.");
      }
    }
    void load();
    return () => controller.abort();
  }, [id, byUser, userId, router]);

  const next = useCallback(
    async (direction = 1) => {
      if (!story || moving.current) return;
      const position = siblings.findIndex((s) => s.id === story.id);
      const candidate = siblings[position + direction];
      if (candidate) {
        moving.current = true;
        router.replace(`/stories/${candidate.id}`);
        return;
      }
      if (direction < 0) return;
      moving.current = true;
      // Continue with the next author in the subscriptions tray. The REST API
      // rechecks access; no cached file or story is treated as authorization.
      let cursor: string | undefined;
      const authors: string[] = [];
      do {
        const result = await createStoriesClient().feed(cursor);
        if (!result.ok) {
          moving.current = false;
          setError(describeFailure(result.failure));
          return;
        }
        authors.push(...result.data.items.map((group) => group.author.id));
        cursor = result.data.nextCursor ?? undefined;
      } while (cursor);
      const following = authors[authors.indexOf(story.author.id) + 1];
      if (following && following !== story.author.id)
        router.replace(`/stories/user/${following}`);
      else router.push("/");
    },
    [story, siblings, router],
  );

  // Expiry applies on screen even when no cleanup has run. Revalidate access
  // after tab switches and during a long video, including follow revocation.
  useEffect(() => {
    if (!story) return;
    const controller = new AbortController();
    const expire = () => {
      setReady(false);
      setStory(undefined);
      setError("Срок действия истории истёк.");
    };
    const left = new Date(story.expiresAt).getTime() - Date.now();
    if (left <= 0) {
      expire();
      return;
    }
    const expiry = setTimeout(expire, left);
    const check = () => {
      setHidden(document.hidden);
      if (document.hidden) return;
      void createStoriesClient()
        .get(story.id, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (!result.ok) {
            setReady(false);
            setStory(undefined);
            setError(describeFailure(result.failure));
          } else if (story.status !== result.data.story.status)
            setStory(result.data.story);
        });
    };
    const poll = setInterval(
      check,
      story.status === "processing" ? 1500 : 15_000,
    );
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      controller.abort();
      clearTimeout(expiry);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [story]);

  useEffect(() => {
    const player = media.current;
    if (!player) return;
    if (stopped) player.pause();
    else void player.play().catch(() => setPaused(true));
  }, [stopped, story?.status]);
  useEffect(() => {
    if (story?.type !== "photo" || stopped) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      imageElapsed.current += now - last;
      last = now;
      setProgress(
        Math.min(
          100,
          (imageElapsed.current / storyRules.photoDurationMs) * 100,
        ),
      );
      if (imageElapsed.current >= storyRules.photoDurationMs) void next();
    }, 100);
    return () => clearInterval(timer);
  }, [story?.type, stopped, next]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "Escape") {
        if (audienceOpen) setAudienceOpen(false);
        else if (deleting) setDeleting(false);
        else router.push("/");
      }
      if (e.key === " " && !audienceOpen && !deleting) {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === "ArrowRight" && !audienceOpen && !deleting) void next();
      if (e.key === "ArrowLeft" && !audienceOpen && !deleting) void next(-1);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [next, router, audienceOpen, deleting]);

  async function displayed() {
    setReady(true);
    if (!story || viewed.current) return;
    viewed.current = true;
    const result = await createStoriesClient().view(story.id);
    if (!result.ok) {
      viewed.current = false;
      if (
        result.failure.kind === "api" &&
        [401, 403, 404].includes(result.failure.status)
      ) {
        setStory(undefined);
        setError(describeFailure(result.failure));
      }
    }
  }
  async function showAudience(cursor?: string) {
    if (!story || busy) return;
    setAudienceOpen(true);
    setBusy(true);
    setAudienceError(undefined);
    const result = await createStoriesClient().viewers(story.id, cursor);
    setBusy(false);
    if (result.ok)
      setAudience((old) => ({
        ...result.data,
        items:
          cursor && old
            ? [...old.items, ...result.data.items]
            : result.data.items,
      }));
    else setAudienceError(describeFailure(result.failure));
  }
  async function remove() {
    if (!story || busy) return;
    setBusy(true);
    const result = await createStoriesClient().remove(story.id);
    setBusy(false);
    if (result.ok) router.push("/");
    else {
      setDeleting(false);
      setError(describeFailure(result.failure));
    }
  }
  const shell =
    "fixed inset-0 z-80 flex flex-col items-center justify-center bg-black text-white";
  if (!user)
    return (
      <section className={shell}>
        <p>Войдите, чтобы смотреть истории.</p>
        <Link href="/auth/login">Войти</Link>
      </section>
    );
  if (error || !story)
    return (
      <section className={shell}>
        <p role={error ? "alert" : "status"}>{error ?? "Загрузка истории…"}</p>
        <Link href="/" className="mt-4 underline">
          На главную
        </Link>
      </section>
    );
  const self = user.id === story.author.id;
  return (
    <section aria-label="Просмотр истории" className={shell}>
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-hidden bg-neutral-950 md:my-3 md:rounded-xl">
        <header className="z-10 flex flex-col gap-3 bg-linear-to-b from-black/80 to-transparent p-4">
          <div className="flex gap-1" aria-label="Прогресс историй">
            {siblings.map((s) => (
              <div
                key={s.id}
                className="h-1 flex-1 overflow-hidden rounded bg-white/30"
              >
                <div
                  className="h-full bg-white"
                  style={{
                    width: `${s.id === story.id ? progress : siblings.findIndex((x) => x.id === s.id) < siblings.findIndex((x) => x.id === story.id) ? 100 : 0}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Avatar
              name={story.author.username}
              src={story.author.avatarUrl}
              size={32}
            />
            <Link
              href={`/${story.author.username}`}
              className="min-w-0 flex-1 truncate font-semibold"
            >
              {story.author.username}
            </Link>
            <button
              type="button"
              aria-label={
                paused ? "Продолжить историю" : "Приостановить историю"
              }
              onClick={() => setPaused((p) => !p)}
              className="p-2"
            >
              {paused ? "▶" : "Ⅱ"}
            </button>
            <Link href="/" aria-label="Закрыть историю" className="p-2 text-xl">
              ✕
            </Link>
          </div>
        </header>
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onPointerDown={(e) => {
            if (
              e.target === e.currentTarget ||
              e.target instanceof HTMLImageElement ||
              e.target instanceof HTMLVideoElement
            )
              setHolding(true);
          }}
          onPointerUp={() => setHolding(false)}
          onPointerLeave={() => setHolding(false)}
          onPointerCancel={() => setHolding(false)}
        >
          {story.status === "processing" ? (
            <p role="status">Обрабатываем видео…</p>
          ) : story.status === "failed" ? (
            <p role="alert">
              Не удалось обработать видео. Удалите историю и попробуйте другой
              файл.
            </p>
          ) : story.type === "video" && story.video ? (
            <video
              ref={media}
              src={story.video.url}
              poster={story.image.url}
              playsInline
              autoPlay
              muted
              controls
              aria-label="Видео истории"
              className="max-h-full w-full object-contain"
              onLoadedData={() => void displayed()}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration) setProgress((v.currentTime / v.duration) * 100);
              }}
              onEnded={() => void next()}
              onError={() => {
                setPaused(true);
                void createStoriesClient()
                  .get(story.id)
                  .then((result) => {
                    if (!result.ok) {
                      setStory(undefined);
                      setError(describeFailure(result.failure));
                    } else
                      setPlaybackError(
                        "Не удалось воспроизвести видео. Попробуйте другой браузер или откройте историю снова.",
                      );
                  });
              }}
            />
          ) : (
            <MediaImage
              src={story.image.url}
              alt={`История ${story.author.username}`}
              className="max-h-full w-full object-contain"
              onLoad={() => void displayed()}
              onError={() => {
                setStory(undefined);
                setError("Фото истории недоступно.");
              }}
            />
          )}
        </div>
        {playbackError && (
          <p role="alert" className="px-4 text-sm text-amber-200">
            {playbackError}
          </p>
        )}
        <footer className="z-10 flex flex-wrap items-center justify-between gap-2 bg-black/70 p-4 text-sm">
          <button
            type="button"
            onClick={() => void next(-1)}
            disabled={siblings.findIndex((s) => s.id === story.id) <= 0}
            className="p-2 disabled:opacity-30"
          >
            Предыдущая
          </button>
          <ShareButton
            key={story.id}
            kind="story"
            contentId={story.id}
            initialCount={story.shareCount}
            compact
            onOpenChange={setSharingOpen}
          />
          {self && (
            <>
              <button
                type="button"
                onClick={() => void showAudience()}
                className="p-2"
              >
                Зрители
              </button>
              <button
                type="button"
                onClick={() => setDeleting(true)}
                className="p-2"
              >
                Удалить
              </button>
            </>
          )}
          <button type="button" onClick={() => void next()} className="p-2">
            Следующая
          </button>
        </footer>
      </div>
      {audienceOpen && (
        <dialog
          ref={audienceDialog}
          aria-label="Зрители истории"
          onCancel={(event) => {
            event.preventDefault();
            setAudienceOpen(false);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAudienceOpen(false);
          }}
          className="fixed inset-x-0 top-auto bottom-0 mx-auto max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-neutral-900 p-5 text-white shadow-xl backdrop:bg-black/60"
        >
          <div className="flex justify-between">
            <h2 className="font-semibold">
              Зрители {audience ? `(${audience.total})` : ""}
            </h2>
            <button
              type="button"
              onClick={() => setAudienceOpen(false)}
              aria-label="Закрыть список зрителей"
            >
              ✕
            </button>
          </div>
          {audience?.items.map((item) => (
            <Link
              key={item.user.id}
              href={`/${item.user.username}`}
              className="mt-4 flex items-center gap-3"
            >
              <Avatar
                name={item.user.username}
                src={item.user.avatarUrl}
                size={36}
              />
              {item.user.username}
            </Link>
          ))}
          {audience?.total === 0 && (
            <p className="py-5 text-sm">Пока никто не посмотрел историю.</p>
          )}
          {busy && <p role="status">Загрузка…</p>}
          {audienceError && <p role="alert">{audienceError}</p>}
          {audience?.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void showAudience(audience.nextCursor ?? undefined)
              }
              className="mt-4"
            >
              Показать ещё зрителей
            </button>
          )}
        </dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title="Удалить историю?"
          description="История сразу станет недоступна зрителям."
          confirmLabel="Удалить историю"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(false)}
        />
      )}
    </section>
  );
}
