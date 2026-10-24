"use client";

import Link from "next/link";
import { CallButtons } from "@/features/calls/call-buttons";
import { CallHistory } from "@/features/calls/call-history";
import { useEffect, useRef, useState } from "react";
import { type DirectMessage, type Conversation } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { ChevronRightIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import type { ApiFailure } from "@/lib/api/client";
import { createDirectClient } from "@/lib/api/direct";
import { cn } from "@/lib/utils";

import type { ConnectionState } from "./use-direct-events";
import { useThread, type Outgoing } from "./use-thread";

import { PrivateAudio } from "./private-audio";
import { AttachmentComposer } from "./attachment-composer";
import { MediaImage } from "@/components/ui-ig/media-image";

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; failure: ApiFailure }
  | { state: "ready"; conversation: Conversation };

// One conversation: header with the other person, history (older pages on
// demand), unsent messages with retry, and the composer.
export function Thread({
  conversationId,
  viewerId,
  syncKey,
  connection,
  onActivity,
}: {
  conversationId: string;
  viewerId: string;
  // Changes when the stream says this conversation (or everything) may
  // have news: ready after (re)connect, a notice, focus or the timer.
  syncKey: number;
  connection: ConnectionState;
  onActivity: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void createDirectClient()
      .conversation(conversationId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok)
          setLoad({ state: "ready", conversation: result.data.conversation });
        else if (
          result.failure.kind === "api" &&
          (result.failure.status === 404 || result.failure.status === 400)
        )
          setLoad({ state: "missing" });
        else setLoad({ state: "error", failure: result.failure });
      });
    return () => controller.abort();
  }, [conversationId, revision]);

  if (load.state === "loading")
    return (
      <p role="status" className="m-auto text-sm text-muted-foreground">
        Загрузка диалога…
      </p>
    );
  if (load.state === "missing")
    return (
      <div className="m-auto flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Диалог не найден</h1>
        <Link href="/direct" className="text-sm font-semibold text-ig-link">
          К сообщениям
        </Link>
      </div>
    );
  if (load.state === "error")
    return (
      <div className="m-auto p-6">
        <ApiErrorNotice
          failure={load.failure}
          onRetry={() => setRevision((value) => value + 1)}
        />
      </div>
    );
  return (
    <ThreadBody
      conversation={load.conversation}
      viewerId={viewerId}
      syncKey={syncKey}
      connection={connection}
      onActivity={onActivity}
    />
  );
}

function ThreadBody({
  conversation,
  viewerId,
  syncKey,
  connection,
  onActivity,
}: {
  conversation: Conversation;
  viewerId: string;
  syncKey: number;
  connection: ConnectionState;
  onActivity: () => void;
}) {
  const thread = useThread(conversation.id, onActivity);
  const sync = useRef(thread.sync);
  useEffect(() => {
    sync.current = thread.sync;
  });
  useEffect(() => sync.current(), [syncKey]);
  const { peer } = conversation;
  const bottom = useRef<HTMLDivElement>(null);
  const count = thread.messages.length + thread.outbox.length;
  const newest = thread.messages.at(-1)?.id;

  // Keep the newest message in view when it or a pending one arrives.
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [count, newest]);

  return (
    <section
      aria-label={`Диалог с ${peer.username}`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-18.5 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href="/direct"
          aria-label="Назад к сообщениям"
          className="rotate-180 md:hidden"
        >
          <ChevronRightIcon />
        </Link>
        <Link
          href={`/${peer.username}`}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <Avatar name={peer.username} src={peer.avatarUrl} size={44} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-semibold">
              {peer.displayName || peer.username}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {peer.username}
            </span>
          </span>
        </Link>
        <CallButtons conversation={conversation} />
        <ConnectionBadge state={connection} />
      </header>
      <CallHistory conversationId={conversation.id} viewerId={viewerId} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {thread.hasOlder && (
          <button
            type="button"
            onClick={thread.loadOlder}
            disabled={thread.loading}
            className="mx-auto mb-2 text-sm font-semibold text-ig-link disabled:opacity-50"
          >
            {thread.loading ? "Загрузка…" : "Показать предыдущие сообщения"}
          </button>
        )}
        {thread.failure && (
          <ApiErrorNotice failure={thread.failure} onRetry={thread.reload} />
        )}
        {thread.loaded && count === 0 && (
          <div className="m-auto flex flex-col items-center gap-2 text-center">
            <Avatar name={peer.username} src={peer.avatarUrl} size={96} />
            <p className="text-lg font-semibold">{peer.username}</p>
            <p className="text-sm text-muted-foreground">
              Напишите первое сообщение.
            </p>
          </div>
        )}
        <ol aria-label="Сообщения" className="mt-auto flex flex-col gap-1">
          {thread.messages.map((message) => (
            <li key={message.id} className="flex flex-col">
              <MessageContent
                message={message}
                mine={message.senderId === viewerId}
              />
            </li>
          ))}
          {thread.outbox.map((message) => (
            <Pending
              key={message.clientMessageId}
              message={message}
              onRetry={() => thread.retry(message.clientMessageId)}
              onDiscard={() => thread.discard(message.clientMessageId)}
            />
          ))}
        </ol>
        <div ref={bottom} />
      </div>

      <AttachmentComposer onSend={thread.send} />
    </section>
  );
}

// Live: messages arrive by themselves. Otherwise the user knows that new
// ones may be late; sent messages still go out over REST.
function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span
      role="status"
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "live"
            ? "bg-emerald-500"
            : state === "offline"
              ? "bg-destructive"
              : "bg-amber-400",
        )}
      />
      {state === "live"
        ? "В сети"
        : state === "offline"
          ? "Нет соединения. Переподключаемся…"
          : "Подключение…"}
    </span>
  );
}

function Bubble({
  mine,
  text,
  muted,
}: {
  mine: boolean;
  text: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "max-w-[70%] rounded-3xl px-3 py-2 text-[15px] break-words whitespace-pre-line",
        mine ? "self-end bg-ig-blue text-white" : "self-start bg-secondary",
        muted && "opacity-60",
      )}
    >
      {text}
    </div>
  );
}

function Pending({
  message,
  onRetry,
  onDiscard,
}: {
  message: Outgoing;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const failed = message.status === "failed";
  return (
    <li className="flex flex-col items-end gap-1">
      <Bubble
        mine
        text={[
          message.attachment
            ? message.attachment.type === "voice"
              ? "Голосовое сообщение"
              : "Фото / GIF"
            : "",
          message.text,
        ]
          .filter(Boolean)
          .join(" · ")}
        muted
      />
      {failed ? (
        <p role="alert" className="flex flex-wrap justify-end gap-2 text-xs">
          <span className="text-destructive">
            Не отправлено. {message.error}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="font-semibold text-ig-link"
          >
            Повторить
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="font-semibold text-muted-foreground"
          >
            Удалить
          </button>
        </p>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          Отправка…
        </p>
      )}
    </li>
  );
}

function MessageContent({
  message,
  mine,
}: {
  message: DirectMessage;
  mine: boolean;
}) {
  const attachment = message.attachment;
  if (!attachment) return <Bubble mine={mine} text={message.text} />;
  return (
    <div
      className={cn(
        "flex max-w-[85%] min-w-0 flex-col gap-1 md:max-w-[70%]",
        mine ? "self-end items-end" : "self-start items-start",
      )}
    >
      {attachment?.type === "image" && (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-full overflow-hidden rounded-2xl border"
        >
          <MediaImage
            src={attachment.url}
            alt="Фото или GIF в сообщении"
            width={attachment.width}
            height={attachment.height}
            loading="lazy"
            className="max-h-80 max-w-full object-contain"
          />
        </a>
      )}
      {attachment?.type === "voice" && (
        <div className="max-w-full rounded-2xl border bg-secondary/40 p-2">
          <PrivateAudio
            src={attachment.url}
            opusUrl={attachment.opusUrl}
            label="Голосовое сообщение"
          />
          <p className="mt-1 px-2 text-xs tabular-nums text-muted-foreground">
            {Math.floor(attachment.durationMs / 60000)}:
            {String(Math.floor(attachment.durationMs / 1000) % 60).padStart(
              2,
              "0",
            )}
          </p>
        </div>
      )}
      {message.text && <Bubble mine={mine} text={message.text} />}
    </div>
  );
}
