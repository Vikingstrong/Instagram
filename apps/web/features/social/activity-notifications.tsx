"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Notification } from "@instagram/contracts";
import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeIdentity } from "@/features/auth/home-access";
import { createNotificationsClient } from "@/lib/api/notifications";
import type { ApiFailure } from "@/lib/api/client";

const message = (kind: Notification["kind"]) => {
  switch (kind) {
    case "POST_LIKE":
      return "оценил(а) вашу публикацию";
    case "COMMENT":
      return "оставил(а) комментарий к вашей публикации";
    case "REPLY":
      return "ответил(а) на ваш комментарий";
    case "COMMENT_LIKE":
      return "оценил(а) ваш комментарий";
  }
};

export function ActivityNotifications() {
  const viewerId = useHomeIdentity()?.id;
  return viewerId ? <ActivityList key={viewerId} /> : null;
}

function ActivityList() {
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ApiFailure>();
  const latest = useRef(0);

  const load = useCallback(async (after?: string, signal?: AbortSignal) => {
    const request = ++latest.current;
    setLoading(true);
    const result = await createNotificationsClient().list(after, signal);
    if (signal?.aborted || request !== latest.current) return;
    setLoading(false);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }
    setFailure(undefined);
    setItems((current) =>
      after
        ? [
            ...current,
            ...result.data.items.filter(
              (item) => !current.some((old) => old.id === item.id),
            ),
          ]
        : result.data.items,
    );
    setCursor(result.data.nextCursor);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(undefined, controller.signal);
    });
    const source = new EventSource("/api/v1/direct/events");
    const refresh = () => {
      if (document.visibilityState === "visible")
        void load(undefined, controller.signal);
    };
    source.addEventListener("ready", refresh);
    source.addEventListener("notification", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      controller.abort();
      source.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  return (
    <section aria-label="Активность" className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Активность</h2>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2">
            <Avatar
              name={item.actor.username}
              src={item.actor.avatarUrl}
              size={44}
            />
            <div className="min-w-0 flex-1 text-sm">
              <Link href={`/${item.actor.username}`} className="font-semibold">
                {item.actor.username}
              </Link>{" "}
              {message(item.kind)}
              <time
                dateTime={item.createdAt}
                className="block text-xs text-muted-foreground"
              >
                {new Date(item.createdAt).toLocaleString("ru-RU")}
              </time>
            </div>
            <Link
              href={`/p/${item.postId}`}
              className="text-sm font-semibold text-ig-link"
            >
              Открыть
            </Link>
          </li>
        ))}
      </ul>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка…
        </p>
      )}
      {failure && (
        <ApiErrorNotice failure={failure} onRetry={() => void load()} />
      )}
      {!loading && !failure && items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Новых событий нет.
        </p>
      )}
      {cursor && !loading && (
        <button
          type="button"
          onClick={() => void load(cursor)}
          className="py-2 text-sm font-semibold text-ig-link"
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
