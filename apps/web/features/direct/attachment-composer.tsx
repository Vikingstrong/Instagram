"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  directImageRules,
  DirectMessageTextSchema,
} from "@instagram/contracts";
import { MediaImage } from "@/components/ui-ig/media-image";
import { cn } from "@/lib/utils";
import type { OutgoingAttachment } from "./use-thread";
import { PrivateAudio } from "./private-audio";
import { useVoiceRecorder } from "./use-voice-recorder";

export function AttachmentComposer({
  onSend,
}: {
  onSend: (text: string, attachment?: OutgoingAttachment) => void;
}) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<OutgoingAttachment>();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);
  const recording = useVoiceRecorder((file) => {
    setError(undefined);
    setAttachment({ file, type: "voice" });
    setPreview(URL.createObjectURL(file));
  });
  const busy = recording.state !== "idle";
  const length = [...text].length;
  const valid = attachment
    ? length <= 1000
    : DirectMessageTextSchema.safeParse(text).success;
  function clear() {
    setAttachment(undefined);
    setPreview(undefined);
    if (input.current) input.current.value = "";
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    onSend(text, attachment);
    setText("");
    clear();
    setError(undefined);
  }
  return (
    <form onSubmit={submit} noValidate className="shrink-0 border-t p-3 md:p-4">
      {attachment && preview && (
        <div className="mb-3 w-fit max-w-full rounded-xl border bg-secondary/40 p-2">
          {attachment.type === "image" ? (
            <MediaImage
              src={preview}
              alt="Превью сообщения"
              className="max-h-44 max-w-full rounded-lg object-contain"
            />
          ) : (
            <PrivateAudio src={preview} label="Прослушать запись" />
          )}
          <button
            type="button"
            onClick={clear}
            className="mt-2 block text-xs font-semibold text-muted-foreground"
          >
            Убрать вложение
          </button>
        </div>
      )}
      {busy ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
          role="status"
        >
          <span className="flex-1 tabular-nums">
            {recording.state === "starting"
              ? "Разрешите доступ к микрофону…"
              : recording.state === "stopping"
                ? "Подготовка записи…"
                : `Запись · ${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")} / 3:00`}
          </span>
          {recording.state === "recording" && (
            <button
              type="button"
              onClick={recording.stop}
              className="font-semibold"
            >
              Остановить
            </button>
          )}
          <button
            type="button"
            onClick={recording.cancel}
            className="text-muted-foreground"
          >
            Отменить запись
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-2 rounded-3xl border px-4 py-2">
            <label htmlFor="direct-message" className="sr-only">
              Сообщение
            </label>
            <textarea
              id="direct-message"
              rows={1}
              value={text}
              placeholder="Напишите сообщение…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="max-h-30 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            {(text.length > 0 || attachment) && (
              <button
                type="submit"
                disabled={!valid}
                className="py-1 text-sm font-semibold text-ig-blue disabled:opacity-50"
              >
                Отправить
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-5 px-2 text-xs font-semibold text-muted-foreground">
            <label className={cn("cursor-pointer", attachment && "opacity-40")}>
              Фото / GIF
              <input
                ref={input}
                aria-label="Фото или GIF в сообщение"
                type="file"
                disabled={!!attachment}
                accept={directImageRules.formats.join(",")}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (
                    !(directImageRules.formats as readonly string[]).includes(
                      file.type,
                    ) ||
                    file.size > directImageRules.maxBytes
                  ) {
                    setError("Выберите JPEG, PNG, WebP или GIF до 10 МБ.");
                    event.target.value = "";
                    return;
                  }
                  setError(undefined);
                  setAttachment({ file, type: "image" });
                  setPreview(URL.createObjectURL(file));
                }}
              />
            </label>
            <button
              type="button"
              disabled={!!attachment}
              onClick={() => {
                setError(undefined);
                void recording.start();
              }}
              className="disabled:opacity-40"
            >
              Записать голосовое
            </button>
            {length > 900 && (
              <span
                className={cn(
                  "ml-auto tabular-nums",
                  length > 1000 && "text-destructive",
                )}
              >
                {length} / 1000
              </span>
            )}
          </div>
        </>
      )}
      {(error || recording.error) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error ?? recording.error}
        </p>
      )}
    </form>
  );
}
