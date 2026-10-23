"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { UserSummary } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { CloseIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { openModal } from "@/components/ui-ig/confirm-dialog";
import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";

import { usePagedList } from "./use-paged-list";

// Modal list of followers/followings with "load more" paging. The owner of a
// followers list may remove a follower from it.
export function UserListDialog({
  userId,
  kind,
  removable,
  onRemoved,
  onClose,
}: {
  userId: string;
  kind: "followers" | "following";
  removable?: boolean;
  onRemoved?: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = kind === "followers" ? "Подписчики" : "Подписки";
  const list = usePagedList<UserSummary>((cursor, signal) => {
    const client = createSocialClient();
    return kind === "followers"
      ? client.followers(userId, cursor, signal)
      : client.following(userId, cursor, signal);
  }, `${kind}:${userId}`);
  const [removing, setRemoving] = useState<string>();
  const [removeError, setRemoveError] = useState<string>();

  useEffect(() => openModal(dialog.current), []);

  async function remove(user: UserSummary) {
    setRemoving(user.id);
    setRemoveError(undefined);
    const result = await createSocialClient().removeFollower(user.id);
    setRemoving(undefined);
    if (!result.ok) {
      setRemoveError(describeFailure(result.failure));
      return;
    }
    list.remove((item) => item.id !== user.id);
    onRemoved?.();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="user-list-title"
      onCancel={onClose}
      onClose={onClose}
      className="fixed inset-0 z-70 m-auto flex max-h-[min(400px,80dvh)] w-[calc(100%-2rem)] max-w-100 flex-col rounded-xl border bg-ig-elevated p-0 text-foreground shadow-2xl backdrop:bg-black/60"
    >
      <header className="relative flex h-11 shrink-0 items-center justify-center border-b">
        <h2 id="user-list-title" className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="absolute right-3"
        >
          <CloseIcon className="size-5" />
        </button>
      </header>
      <div className="overflow-y-auto px-4 py-2">
        {removeError && (
          <p role="alert" className="py-2 text-sm text-destructive">
            {removeError}
          </p>
        )}
        <ul>
          {list.items.map((user) => (
            <li key={user.id} className="flex items-center gap-3 py-2">
              <Avatar name={user.username} size={44} />
              <div className="min-w-0 flex-1 leading-tight">
                <Link
                  href={`/${user.username}`}
                  onClick={onClose}
                  className="block truncate text-sm font-semibold"
                >
                  {user.username}
                </Link>
                {user.displayName && (
                  <p className="truncate text-sm text-muted-foreground">
                    {user.displayName}
                  </p>
                )}
              </div>
              {removable && (
                <button
                  type="button"
                  disabled={removing === user.id}
                  onClick={() => void remove(user)}
                  aria-label={`Удалить подписчика ${user.username}`}
                  className="h-8 rounded-lg bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80 disabled:opacity-60"
                >
                  Удалить
                </button>
              )}
            </li>
          ))}
        </ul>
        {list.loading && (
          <p role="status" className="py-4 text-center text-sm text-muted-foreground">
            Загрузка…
          </p>
        )}
        {list.failure && (
          <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
        )}
        {!list.loading && !list.failure && list.items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Здесь пока никого нет.
          </p>
        )}
        {!list.loading && !list.failure && list.cursor && (
          <button
            type="button"
            onClick={list.more}
            className="w-full py-3 text-sm font-semibold text-ig-link"
          >
            Показать ещё
          </button>
        )}
      </div>
    </dialog>
  );
}
