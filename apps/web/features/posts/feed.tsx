"use client";

import Link from "next/link";
import type { Post } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { usePagedList } from "@/features/social/use-paged-list";
import { createPostsClient } from "@/lib/api/posts";

import { FeedPost } from "./feed-post";

// FR-05 home feed: own posts and approved followings, newest first, with
// "load more". The API filters access before paging.
export function Feed({ viewerId }: { viewerId: string }) {
  const list = usePagedList<Post>(
    (cursor, signal) => createPostsClient().feed(cursor, signal),
    viewerId,
  );

  if (list.items.length === 0) {
    if (list.failure)
      return <ApiErrorNotice failure={list.failure} onRetry={list.retry} />;
    if (list.loading)
      return (
        <p role="status" className="py-16 text-center text-sm text-muted-foreground">
          Загрузка ленты…
        </p>
      );
    return (
      <section className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <h2 className="text-xl font-semibold">В ленте пока пусто</h2>
        <p className="text-sm text-muted-foreground">
          Здесь появятся ваши публикации и фото аккаунтов, на которые вы подписаны.
        </p>
        <div className="flex gap-4 text-sm font-semibold">
          <Link href="/search" className="text-ig-link hover:text-foreground">
            Найти людей
          </Link>
          <Link href="/create" className="text-ig-link hover:text-foreground">
            Опубликовать фото
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Лента" className="flex flex-col gap-6">
      {list.items.map((post) => (
        <FeedPost key={post.id} post={post} />
      ))}
      {list.failure && <ApiErrorNotice failure={list.failure} onRetry={list.retry} />}
      {list.cursor && !list.failure && (
        <button
          type="button"
          onClick={list.more}
          disabled={list.loading}
          className="mx-auto h-8 rounded-lg bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80 disabled:opacity-60"
        >
          {list.loading ? "Загрузка…" : "Показать ещё"}
        </button>
      )}
      {!list.cursor && (
        <p className="py-4 text-center text-sm text-muted-foreground">Вы всё посмотрели.</p>
      )}
    </section>
  );
}
