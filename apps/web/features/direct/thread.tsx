"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DirectMessageTextSchema, type Conversation } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { ChevronRightIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import type { ApiFailure } from "@/lib/api/client";
import { createDirectClient } from "@/lib/api/direct";
import { cn } from "@/lib/utils";

import { useThread, type Outgoing } from "./use-thread";

const MESSAGE_LIMIT = 1000;

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
  onActivity,
}: {
  conversationId: string;
  viewerId: string;
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
        if (result.ok) setLoad({ state: "ready", conversation: result.data.conversation });
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
        <ApiErrorNotice failure={load.failure} onRetry={() => setRevision((value) => value + 1)} />
      </div>
    );
  return (
    <ThreadBody
      conversation={load.conversation}
      viewerId={viewerId}
      onActivity={onActivity}
    />
  );
}

function ThreadBody({
  conversation,
  viewerId,
  onActivity,
}: {
  conversation: Conversation;
  viewerId: string;
  onActivity: () => void;
}) {
  const thread = useThread(conversation.id, onActivity);
  const { peer } = conversation;
  const bottom = useRef<HTMLDivElement>(null);
  const count = thread.messages.length + thread.outbox.length;
  const newest = thread.messages.at(-1)?.id;

  // Keep the newest message in view when it or a pending one arrives.
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [count, newest]);

  return (
    <section aria-label={`Диалог с ${peer.username}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-18.5 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/direct" aria-label="Назад к сообщениям" className="rotate-180 md:hidden">
          <ChevronRightIcon />
        </Link>
        <Link href={`/${peer.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={peer.username} src={peer.avatarUrl} size={44} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-semibold">{peer.displayName || peer.username}</span>
            <span className="block truncate text-xs text-muted-foreground">{peer.username}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={thread.refresh}
          disabled={thread.loading}
          className="text-sm font-semibold text-ig-link hover:text-foreground disabled:opacity-50"
        >
          Обновить
        </button>
      </header>

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
          <ApiErrorNotice failure={thread.failure} onRetry={thread.refresh} />
        )}
        {thread.loaded && count === 0 && (
          <div className="m-auto flex flex-col items-center gap-2 text-center">
            <Avatar name={peer.username} src={peer.avatarUrl} size={96} />
            <p className="text-lg font-semibold">{peer.username}</p>
            <p className="text-sm text-muted-foreground">Напишите первое сообщение.</p>
          </div>
        )}
        <ol aria-label="Сообщения" className="mt-auto flex flex-col gap-1">
          {thread.messages.map((message) => (
            <li key={message.id} className="flex flex-col">
              <Bubble mine={message.senderId === viewerId} text={message.text} />
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

      <Composer onSend={thread.send} />
    </section>
  );
}

function Bubble({ mine, text, muted }: { mine: boolean; text: string; muted?: boolean }) {
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
      <Bubble mine text={message.text} muted />
      {failed ? (
        <p role="alert" className="flex flex-wrap justify-end gap-2 text-xs">
          <span className="text-destructive">Не отправлено. {message.error}</span>
          <button type="button" onClick={onRetry} className="font-semibold text-ig-link">
            Повторить
          </button>
          <button type="button" onClick={onDiscard} className="font-semibold text-muted-foreground">
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

// Enter sends, Shift+Enter adds a line. The field clears at once: the text
// lives on in the pending message until the server confirms it.
function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const valid = DirectMessageTextSchema.safeParse(text).success;
  const length = [...text].length;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSend(text);
    setText("");
  }

  return (
    <form onSubmit={submit} noValidate className="shrink-0 p-4">
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
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="max-h-30 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        {text.length > 0 && (
          <button
            type="submit"
            disabled={!valid}
            className="py-1 text-sm font-semibold text-ig-blue hover:text-foreground disabled:opacity-50"
          >
            Отправить
          </button>
        )}
      </div>
      {length > MESSAGE_LIMIT - 100 && (
        <p
          className={cn(
            "mt-1 text-right text-xs text-muted-foreground",
            length > MESSAGE_LIMIT && "text-destructive",
          )}
        >
          {length} / {MESSAGE_LIMIT}
        </p>
      )}
    </form>
  );
}
