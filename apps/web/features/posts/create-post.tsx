"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  imageUploadRules,
  PostCaptionSchema,
  videoUploadRules,
} from "@instagram/contracts";

import { CreateIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { MediaImage } from "@/components/ui-ig/media-image";
import { useHomeIdentity } from "@/features/auth/home-access";
import { describeFailure } from "@/lib/api/messages";
import {
  checkImageFile,
  checkVideoFile,
  createPostsClient,
  isVideoFile,
} from "@/lib/api/posts";
import { replaceLocation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const CAPTION_LIMIT = 2200;
const POLL_MS = 2000;
const codePoints = (value: string) => [...value].length;

type Picked = { file: File; preview: string; video: boolean };
// After a video upload the server prepares it; the page waits for that.
type Phase =
  | { state: "editing" }
  | { state: "uploading"; progress: number }
  | { state: "processing"; postId: string }
  | { state: "failed" };

// FR-04/FR-10 create: one photo or one video and an optional caption. The
// file is checked here for type and size only; the API decodes it and has
// the final word. A failed upload keeps the file and caption so "Повторить"
// sends them again. A video is shown as processing until the server has
// prepared it, then the post opens.
export function CreatePost() {
  const viewer = useHomeIdentity();
  const [picked, setPicked] = useState<Picked>();
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ state: "editing" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const busy = phase.state !== "editing";

  // Each preview URL is released once it is replaced or the page closes.
  const preview = picked?.preview;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  // Waits for the server to finish the video, then opens the post.
  const processingId = phase.state === "processing" ? phase.postId : undefined;
  useEffect(() => {
    if (!processingId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const check = async () => {
      const result = await createPostsClient().get(processingId, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok && result.data.post.status === "ready") {
        replaceLocation(`/p/${processingId}`);
        return;
      }
      if (result.ok && result.data.post.status === "failed") {
        setPhase({ state: "failed" });
        return;
      }
      // Still processing, or a passing network problem: ask again.
      timer = setTimeout(check, POLL_MS);
    };
    timer = setTimeout(check, POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [processingId]);

  function pick(file: File | undefined) {
    if (!file || pending.current) return;
    setFailed(false);
    const video = isVideoFile(file);
    const problem = video ? checkVideoFile(file) : checkImageFile(file);
    if (problem) {
      setError(
        video || file.type.startsWith("image/")
          ? problem
          : "Выберите фото (JPEG, PNG, WebP) или видео (MP4, MOV, WebM).",
      );
      return;
    }
    setError(undefined);
    setPhase({ state: "editing" });
    setPicked({ file, preview: URL.createObjectURL(file), video });
  }

  const captionValid = PostCaptionSchema.safeParse(caption).success;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked || !captionValid || pending.current || busy) return;
    pending.current = true;
    setError(undefined);
    setPhase({ state: "uploading", progress: 0 });
    const client = createPostsClient();
    const result = picked.video
      ? await client.createVideo(picked.file, caption, (progress) =>
          setPhase({ state: "uploading", progress }),
        )
      : await client.create(picked.file, caption);
    pending.current = false;
    if (!result.ok) {
      setPhase({ state: "editing" });
      setFailed(true);
      setError(describeFailure(result.failure));
      return;
    }
    if (result.data.post.status === "ready") {
      replaceLocation(`/p/${result.data.post.id}`);
      return;
    }
    setPhase({ state: "processing", postId: result.data.post.id });
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  }

  const kind = picked?.video ? "видео" : "фото";
  return (
    <div className="mx-auto w-full max-w-233.75 px-4 py-6 md:px-5 md:py-10">
      <form
        onSubmit={submit}
        noValidate
        className="overflow-hidden rounded-xl border bg-ig-elevated"
      >
        <header className="relative flex h-11 items-center justify-center border-b px-4">
          <h1 className="text-base font-semibold">Создание публикации</h1>
          {picked && phase.state === "editing" && (
            <button
              type="submit"
              disabled={!captionValid}
              className="absolute right-4 text-sm font-semibold text-ig-blue hover:text-foreground disabled:opacity-50"
            >
              {failed ? "Повторить" : "Поделиться"}
            </button>
          )}
        </header>

        <input
          ref={input}
          type="file"
          accept={[...imageUploadRules.formats, ...videoUploadRules.formats].join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Фото или видео для публикации"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            // Choosing the same file again must fire change again.
            event.target.value = "";
          }}
        />

        {!picked ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            className={cn(
              "flex min-h-100 flex-col items-center justify-center gap-4 px-6 py-16 text-center transition-colors",
              dragging && "bg-secondary",
            )}
          >
            <CreateIcon className="size-20 stroke-1" />
            <p className="text-xl">Перетащите сюда фото или видео</p>
            <p className="text-sm text-muted-foreground">
              Фото: JPEG, PNG или WebP до 10 МБ. Видео: MP4, MOV или WebM до 100 МБ и
              90 секунд.
            </p>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="h-8 rounded-lg bg-ig-blue px-4 text-sm font-semibold text-white hover:bg-ig-blue-hover"
            >
              Выбрать на компьютере
            </button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col md:flex-row">
            <div className="relative flex items-center justify-center bg-black md:min-w-0 md:flex-[1_1_60%]">
              {picked.video ? (
                <video
                  src={picked.preview}
                  aria-label="Выбранное видео"
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  className="max-h-[70dvh] w-full"
                />
              ) : (
                <MediaImage
                  src={picked.preview}
                  alt="Выбранное фото"
                  className="max-h-[70dvh] w-full object-contain"
                />
              )}
              <PhaseOverlay phase={phase} />
            </div>
            <div className="flex flex-col gap-3 p-4 md:w-84 md:shrink-0 md:border-l lg:w-100">
              {viewer && (
                <div className="flex items-center gap-3">
                  <Avatar name={viewer.username} size={28} />
                  <span className="text-sm font-semibold">{viewer.username}</span>
                </div>
              )}
              <label htmlFor="post-caption" className="sr-only">
                Подпись
              </label>
              <textarea
                id="post-caption"
                value={caption}
                onChange={(event) => {
                  setCaption(event.target.value);
                  setFailed(false);
                }}
                disabled={busy}
                placeholder="Добавьте подпись…"
                aria-describedby="post-caption-count"
                className="min-h-40 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <span
                id="post-caption-count"
                className={cn(
                  "self-end text-xs text-muted-foreground",
                  !captionValid && "text-destructive",
                )}
              >
                {codePoints(caption)} / {CAPTION_LIMIT}
              </span>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {phase.state === "failed" && (
                <p role="alert" className="text-sm text-destructive">
                  Не удалось обработать видео. Попробуйте другой файл.
                </p>
              )}
              <button
                type="button"
                disabled={busy && phase.state !== "failed"}
                onClick={() => input.current?.click()}
                className="self-start text-sm font-semibold text-ig-link hover:text-foreground disabled:opacity-50"
              >
                Выбрать другой файл
              </button>
              <span className="sr-only">Сейчас выбрано: {kind}</span>
            </div>
          </div>
        )}
      </form>
      <Link
        href="/live"
        className="mt-4 flex items-center gap-3 rounded-xl border bg-ig-elevated p-4 hover:bg-secondary/40"
      >
        <span
          aria-hidden
          className="rounded-md bg-linear-to-r from-[#d300c5] to-[#ff0069] px-1.5 py-0.5 text-[11px] font-bold text-white uppercase"
        >
          Live
        </span>
        <span className="text-sm">
          <b className="block">Прямой эфир</b>
          <span className="text-muted-foreground">
            Покажите подписчикам, что происходит прямо сейчас
          </span>
        </span>
      </Link>
    </div>
  );
}

// Upload progress and the wait for server-side video processing.
function PhaseOverlay({ phase }: { phase: Phase }) {
  if (phase.state !== "uploading" && phase.state !== "processing") return null;
  const percent =
    phase.state === "uploading" ? Math.round(phase.progress * 100) : undefined;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center text-white">
      {percent !== undefined ? (
        <>
          <p role="status">Загрузка… {percent}%</p>
          <progress
            value={percent}
            max={100}
            aria-label="Загрузка"
            className="h-1.5 w-48 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-white/30 [&::-webkit-progress-value]:bg-white"
          />
        </>
      ) : (
        <>
          <span
            aria-hidden
            className="size-8 animate-spin rounded-full border-2 border-white border-r-transparent"
          />
          <p role="status">Обрабатываем видео… Это займёт до минуты.</p>
        </>
      )}
    </div>
  );
}
