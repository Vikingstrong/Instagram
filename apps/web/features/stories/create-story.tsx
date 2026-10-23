"use client";
import { MediaImage } from "@/components/ui-ig/media-image";
import Link from "next/link";
import {
  ArrowLeft,
  Clock3,
  ImagePlus,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createStoriesClient } from "@/lib/api/stories";
import { checkImageFile, checkVideoFile } from "@/lib/api/posts";
import { describeFailure } from "@/lib/api/messages";
import { useHomeIdentity } from "@/features/auth/home-access";
export function CreateStory() {
  const user = useHomeIdentity();
  const router = useRouter();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  if (!user?.emailVerified)
    return (
      <p className="p-8">
        Войдите и подтвердите email, чтобы публиковать истории.{" "}
        <Link href="/auth/login" className="text-ig-link">
          Войти
        </Link>
      </p>
    );
  function pick(selected?: File) {
    if (!selected || pending.current) return;
    const problem = selected.type.startsWith("video/")
      ? checkVideoFile(selected)
      : checkImageFile(selected);
    if (problem) {
      setError(problem);
      return;
    }
    setPreview(URL.createObjectURL(selected));
    setFile(selected);
    setError(undefined);
  }
  async function submit() {
    if (!file || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    upload.current = controller;
    const result = await createStoriesClient().create(file, controller.signal);
    if (controller.signal.aborted) return;
    pending.current = false;
    setBusy(false);
    if (result.ok) router.push(`/stories/${result.data.story.id}`);
    else setError(describeFailure(result.failure));
  }
  return (
    <section className="mx-auto w-full max-w-233.75 px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6">
        <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          Ваша творческая студия
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Новая история</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Для моментов, которыми хочется поделиться прямо сейчас.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        aria-label="Фото или видео для истории"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
        className="sr-only"
        tabIndex={-1}
        disabled={busy}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="overflow-hidden rounded-3xl border bg-background shadow-xl shadow-black/5 md:grid md:grid-cols-[minmax(0,1fr)_20rem]">
        <div
          className={`flex items-center justify-center bg-linear-to-br from-orange-500/5 via-secondary/20 to-rose-500/5 p-5 sm:p-8 ${dragging ? "ring-2 ring-inset ring-ig-link" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files[0]);
          }}
        >
          <div className="relative flex aspect-9/16 max-h-[60dvh] w-full max-w-72 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[#111318] text-white shadow-2xl">
            {preview ? (
              file?.type.startsWith("video/") ? (
                <video
                  src={preview}
                  controls
                  playsInline
                  className="h-full w-full object-contain"
                  aria-label="Выбранное видео"
                />
              ) : (
                <MediaImage
                  src={preview}
                  alt="Выбранное фото"
                  className="h-full w-full object-contain"
                />
              )
            ) : (
              <div className="flex flex-col items-center gap-5 px-6 text-center">
                <span
                  aria-hidden
                  className="grid size-20 place-items-center rounded-3xl border border-orange-400/20 bg-linear-to-br from-orange-400/20 to-rose-500/15"
                >
                  <ImagePlus
                    className="size-9 text-orange-300"
                    strokeWidth={1.4}
                  />
                </span>
                <div>
                  <p className="text-lg font-medium">Ловите момент</p>
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    Добавьте фото или видео —<br />
                    остальное расскажет история.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold hover:bg-white/20"
                >
                  Выбрать файл
                </button>
              </div>
            )}
            {busy && (
              <div
                role="status"
                className="absolute inset-0 grid place-content-center gap-3 bg-black/65 text-center"
              >
                <span
                  aria-hidden
                  className="mx-auto size-8 animate-spin rounded-full border-2 border-white border-r-transparent"
                />
                Публикуем историю…
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-6 border-t p-5 md:border-t-0 md:border-l md:p-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-orange-400 to-rose-500 p-0.5"
            >
              <span className="grid size-full place-items-center rounded-full bg-background text-sm font-semibold">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.username}</p>
              <p className="text-xs text-muted-foreground">Ваша история</p>
            </div>
          </div>
          <div className="space-y-5 rounded-2xl bg-secondary/35 p-4">
            <div className="flex gap-3">
              <Clock3
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-orange-400"
              />
              <div>
                <p className="text-sm font-medium">Всего на 24 часа</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  После этого история исчезнет автоматически.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <ShieldCheck
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-ig-link"
              />
              <div>
                <p className="text-sm font-medium">Для вашей аудитории</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Историю видят те, кому доступны ваши публикации.
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs leading-5 text-muted-foreground">
              Фото: JPEG, PNG, WebP · до 10 МБ.
              <br />
              Видео: MP4, MOV, WebM · до 100 МБ и 90 секунд.
            </p>
            {file && (
              <p
                className="truncate text-xs text-muted-foreground"
                title={file.name}
              >
                {file.name}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium hover:bg-secondary disabled:opacity-50"
            >
              <Upload aria-hidden className="size-4" />
              {file ? "Выбрать другой файл" : "Загрузить фото или видео"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-auto space-y-4 pt-2">
            <button
              type="button"
              disabled={!file || busy}
              onClick={() => void submit()}
              className="min-h-12 w-full rounded-xl bg-ig-blue px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-ig-blue/15 hover:bg-ig-blue-hover disabled:opacity-50"
            >
              {busy ? "Публикуем…" : "Опубликовать историю"}
            </button>
            <Link
              href="/"
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Отмена
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
