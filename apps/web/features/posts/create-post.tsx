"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { imageUploadRules, PostCaptionSchema } from "@instagram/contracts";

import { CreateIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { MediaImage } from "@/components/ui-ig/media-image";
import { useHomeIdentity } from "@/features/auth/home-access";
import { describeFailure } from "@/lib/api/messages";
import { checkImageFile, createPostsClient } from "@/lib/api/posts";
import { replaceLocation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const CAPTION_LIMIT = 2200;
const codePoints = (value: string) => [...value].length;

type Picked = { file: File; preview: string };

// FR-04 create: one photo and an optional caption. The file is checked here
// for type and size only; the API decodes it and has the final word. A failed
// upload keeps the photo and caption so "Повторить" sends them again.
export function CreatePost() {
  const viewer = useHomeIdentity();
  const [picked, setPicked] = useState<Picked>();
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);

  // Each preview URL is released once it is replaced or the page closes.
  const preview = picked?.preview;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(file: File | undefined) {
    if (!file || pending.current) return;
    setFailed(false);
    const problem = checkImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    setPicked({ file, preview: URL.createObjectURL(file) });
  }

  const captionValid = PostCaptionSchema.safeParse(caption).success;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked || !captionValid || pending.current) return;
    pending.current = true;
    setSending(true);
    setError(undefined);
    const result = await createPostsClient().create(picked.file, caption);
    pending.current = false;
    setSending(false);
    if (result.ok) {
      replaceLocation(`/p/${result.data.post.id}`);
      return;
    }
    setFailed(true);
    setError(describeFailure(result.failure));
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  }

  return (
    <div className="mx-auto w-full max-w-233.75 px-4 py-6 md:px-5 md:py-10">
      <form
        onSubmit={submit}
        noValidate
        className="overflow-hidden rounded-xl border bg-ig-elevated"
      >
        <header className="relative flex h-11 items-center justify-center border-b px-4">
          <h1 className="text-base font-semibold">Создание публикации</h1>
          {picked && (
            <button
              type="submit"
              disabled={sending || !captionValid}
              className="absolute right-4 text-sm font-semibold text-ig-blue hover:text-foreground disabled:opacity-50"
            >
              {sending ? "Публикуем…" : failed ? "Повторить" : "Поделиться"}
            </button>
          )}
        </header>

        <input
          ref={input}
          type="file"
          accept={imageUploadRules.formats.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Фото для публикации"
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
            <p className="text-xl">Перетащите сюда фото</p>
            <p className="text-sm text-muted-foreground">JPEG, PNG или WebP, до 10 МБ</p>
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
            <div className="flex items-center justify-center bg-black md:min-w-0 md:flex-[1_1_60%]">
              <MediaImage
                src={picked.preview}
                alt="Выбранное фото"
                className="max-h-[70dvh] w-full object-contain"
              />
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
                disabled={sending}
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
              <button
                type="button"
                disabled={sending}
                onClick={() => input.current?.click()}
                className="self-start text-sm font-semibold text-ig-link hover:text-foreground disabled:opacity-50"
              >
                Выбрать другое фото
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
