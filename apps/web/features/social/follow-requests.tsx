"use client";

import Link from "next/link";
import { useState } from "react";
import type { FollowRequest } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeIdentity } from "@/features/auth/home-access";
import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";

import { usePagedList } from "./use-paged-list";

// Incoming follow requests with accept/decline. A request handled elsewhere
// (another tab, cancelled by the requester) answers 404 and leaves the list.
export function FollowRequests() {
  const viewerId = useHomeIdentity()?.id;
  const list = usePagedList<FollowRequest>(
    (cursor, signal) => createSocialClient().requests(cursor, signal),
    viewerId,
  );
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  async function decide(item: FollowRequest, action: "accept" | "decline") {
    setBusy(item.user.id);
    setActionError(undefined);
    const client = createSocialClient();
    const result =
      action === "accept"
        ? await client.accept(item.user.id)
        : await client.decline(item.user.id);
    setBusy(undefined);
    const gone =
      result.ok ||
      (result.failure.kind === "api" &&
        result.failure.error.code === "FOLLOW_REQUEST_NOT_FOUND");
    if (!result.ok && !gone) {
      setActionError(describeFailure(result.failure));
      return;
    }
    list.remove((entry) => entry.user.id !== item.user.id);
  }

  return (
    <section aria-label="Запросы на подписку" className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Запросы на подписку</h2>
      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      <ul className="flex flex-col">
        {list.items.map((item) => (
          <li key={item.user.id} className="flex items-center gap-3 py-2">
            <Avatar
              name={item.user.username}
              src={item.user.avatarUrl}
              size={44}
            />
            <div className="min-w-0 flex-1 leading-tight">
              <Link
                href={`/${item.user.username}`}
                className="block truncate text-sm font-semibold"
              >
                {item.user.username}
              </Link>
              <p className="truncate text-sm text-muted-foreground">
                {item.user.displayName || "хочет подписаться на вас"}
              </p>
            </div>
            <button
              type="button"
              disabled={busy === item.user.id}
              onClick={() => void decide(item, "accept")}
              aria-label={`Подтвердить запрос ${item.user.username}`}
              className="h-8 rounded-lg bg-ig-blue px-4 text-sm font-semibold text-white hover:bg-ig-blue-hover disabled:opacity-60"
            >
              Подтвердить
            </button>
            <button
              type="button"
              disabled={busy === item.user.id}
              onClick={() => void decide(item, "decline")}
              aria-label={`Удалить запрос ${item.user.username}`}
              className="h-8 rounded-lg bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80 disabled:opacity-60"
            >
              Удалить
            </button>
          </li>
        ))}
      </ul>
      {list.loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка…
        </p>
      )}
      {list.failure && (
        <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
      )}
      {!list.loading && !list.failure && list.items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Новых запросов нет.
        </p>
      )}
      {!list.loading && !list.failure && list.cursor && (
        <button
          type="button"
          onClick={list.more}
          className="py-2 text-sm font-semibold text-ig-link"
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
