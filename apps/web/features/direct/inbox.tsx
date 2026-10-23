"use client";

import Link from "next/link";
import type { Conversation } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { Avatar } from "@/components/ui-ig/avatar";
import { timeAgo } from "@/features/posts/time";
import { usePagedList } from "@/features/social/use-paged-list";
import { createDirectClient } from "@/lib/api/direct";
import { cn } from "@/lib/utils";

// Conversation list, most recent activity first. `version` changes after a
// send so the order and previews are read again.
export function Inbox({
  viewerId,
  username,
  selectedId,
  version,
  className,
}: {
  viewerId: string;
  username: string;
  selectedId?: string;
  version: number;
  className?: string;
}) {
  const list = usePagedList<Conversation>(
    (cursor, signal) => createDirectClient().conversations(cursor, signal),
    `${viewerId}:${version}`,
  );

  return (
    <nav aria-label="Диалоги" className={cn("flex flex-col", className)}>
      <header className="flex h-18.5 shrink-0 items-center px-6">
        <h1 className="truncate text-xl font-bold">{username}</h1>
      </header>
      <h2 className="px-6 pb-2 text-base font-bold">Сообщения</h2>
      <div className="flex-1 overflow-y-auto">
        {list.failure && (
          <div className="px-6 py-2">
            <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
          </div>
        )}
        {list.loading && list.items.length === 0 && (
          <p role="status" className="px-6 py-4 text-sm text-muted-foreground">
            Загрузка…
          </p>
        )}
        {!list.loading && !list.failure && list.items.length === 0 && (
          <p className="px-6 py-4 text-sm text-muted-foreground">
            Сообщений пока нет. Откройте профиль и нажмите «Написать».
          </p>
        )}
        <ul>
          {list.items.map((conversation) => {
            const { peer, lastMessage, lastCall } = conversation;
            const active = conversation.id === selectedId;
            const recentCall =
              lastCall &&
              (!lastMessage ||
                (lastCall.endedAt ?? lastCall.createdAt) >=
                  lastMessage.createdAt);
            const preview = recentCall
              ? `${lastCall.kind === "VIDEO" ? "Видеозвонок" : "Аудиозвонок"} · ${{ RINGING: "Вызов", ACTIVE: "Идёт звонок", ENDED: "Завершён", DECLINED: "Отклонён", MISSED: "Пропущен", FAILED: "Соединение прервано" }[lastCall.status]}`
              : lastMessage
                ? `${lastMessage.senderId === viewerId ? "Вы: " : ""}${lastMessage.text}`
                : "Начните диалог";
            return (
              <li key={conversation.id}>
                <Link
                  href={`/direct/t/${conversation.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-6 py-2 transition-colors hover:bg-secondary",
                    active && "bg-secondary",
                  )}
                >
                  <Avatar name={peer.username} src={peer.avatarUrl} size={56} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm">
                      {peer.displayName || peer.username}
                    </span>
                    <span className="flex gap-1 text-xs text-muted-foreground">
                      <span className="truncate">{preview}</span>
                      <span className="shrink-0">
                        · {timeAgo(conversation.lastActivityAt)}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {list.cursor && !list.failure && (
          <button
            type="button"
            onClick={list.more}
            disabled={list.loading}
            className="w-full py-3 text-sm font-semibold text-ig-link disabled:opacity-50"
          >
            {list.loading ? "Загрузка…" : "Показать ещё"}
          </button>
        )}
      </div>
    </nav>
  );
}
