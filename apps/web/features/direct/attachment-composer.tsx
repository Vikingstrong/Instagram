"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  directImageRules,
  DirectMessageTextSchema,
} from "@instagram/contracts";
import { Image as ImageIcon, Mic, Square, X } from "lucide-react";
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
        // Instagram-style recording bar in place of the input.
        <div
          className="flex items-center gap-3 rounded-3xl bg-ig-blue px-2 py-1.5 text-sm text-white"
          role="status"
        >
          <button
            type="button"
            aria-label="Отменить запись"
            onClick={recording.cancel}
            className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-white/15"
          >
            <X aria-hidden className="size-5" />
          </button>
          <span className="flex flex-1 items-center gap-2 tabular-nums">
            {recording.state === "recording" && (
              <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
            )}
            {recording.state === "starting"
              ? "Разрешите доступ к микрофону…"
              : recording.state === "stopping"
                ? "Подготовка записи…"
                : `${Math.floor(recording.seconds / 60)}:${String(recording.seconds % 60).padStart(2, "0")}`}
          </span>
          {recording.state === "recording" && (
            <button
              type="button"
              aria-label="Остановить"
              onClick={recording.stop}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-ig-blue transition active:scale-90"
            >
              <Square aria-hidden className="size-3.5 fill-current" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-end gap-2 rounded-3xl border py-2 pr-2 pl-4">
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
          {length > 900 && (
            <span
              className={cn(
                "py-1 text-xs tabular-nums text-muted-foreground",
                length > 1000 && "text-destructive",
              )}
            >
              {length} / 1000
            </span>
          )}
          {text.length > 0 || attachment ? (
            <button
              type="submit"
              disabled={!valid}
              className="px-2 py-1 text-sm font-semibold text-ig-blue disabled:opacity-50"
            >
              Отправить
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label="Записать голосовое"
                onClick={() => {
                  setError(undefined);
                  void recording.start();
                }}
                className="grid size-8 place-items-center rounded-full transition hover:bg-secondary active:scale-90"
              >
                <Mic aria-hidden className="size-6" strokeWidth={1.75} />
              </button>
              <label className="grid size-8 cursor-pointer place-items-center rounded-full transition hover:bg-secondary">
                <ImageIcon aria-hidden className="size-6" strokeWidth={1.75} />
                <input
                  ref={input}
                  aria-label="Фото или GIF в сообщение"
                  type="file"
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
            </>
          )}
        </div>
      )}
      {(error || recording.error) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error ?? recording.error}
        </p>
      )}
    </form>
  );
}
