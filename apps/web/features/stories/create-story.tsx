"use client";
import { MediaImage } from "@/components/ui-ig/media-image";
import Link from "next/link";
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
    <section className="mx-auto flex w-full max-w-lg flex-col gap-5 p-6">
      <h1 className="text-2xl font-semibold">Новая история</h1>
      <p className="text-sm text-muted-foreground">
        Фото или видео исчезнет через 24 часа. Историю видят те, кому доступны
        ваши публикации.
      </p>
      <label className="flex cursor-pointer flex-col gap-3 rounded-xl border border-dashed p-5">
        Фото или видео для истории
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          disabled={busy}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {preview &&
        (file?.type.startsWith("video/") ? (
          <video
            src={preview}
            controls
            playsInline
            className="max-h-[55vh] rounded-xl bg-black"
            aria-label="Выбранное видео"
          />
        ) : (
          <MediaImage
            src={preview}
            alt="Выбранное фото"
            className="max-h-[55vh] rounded-xl object-contain"
          />
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={!file || busy}
        onClick={() => void submit()}
        className="rounded-lg bg-ig-link px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Публикуем…" : "Опубликовать историю"}
      </button>
      <Link href="/" className="text-center text-sm">
        Отмена
      </Link>
    </section>
  );
}
