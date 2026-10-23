"use client";

import Link from "next/link";
import type { Post } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { CreateIcon, ReelsIcon } from "@/components/icons/ig-icons";
import { MediaImage } from "@/components/ui-ig/media-image";
import { usePagedList } from "@/features/social/use-paged-list";
import { createPostsClient } from "@/lib/api/posts";

// Profile grid: square thumbnails, newest first, "load more" paging. The API
// decides what the viewer may see; the caller hides it for private profiles.
export function ProfileGrid({ userId, self }: { userId: string; self: boolean }) {
  const list = usePagedList<Post>(
    (cursor, signal) => createPostsClient().byUser(userId, cursor, signal),
    userId,
  );

  if (list.items.length === 0) {
    if (list.failure)
      return (
        <div className="mx-auto max-w-100 py-10">
          <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
        </div>
      );
    if (list.loading)
      return (
        <p role="status" className="py-16 text-center text-sm text-muted-foreground">
          Загрузка публикаций…
        </p>
      );
    return self ? (
      <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full border-2 border-foreground">
          <CreateIcon />
        </span>
        <h2 className="text-2xl font-extrabold">Поделиться фото</h2>
        <p className="text-sm text-muted-foreground">
          Фото, которыми вы делитесь, будут показываться в вашем профиле.
        </p>
        <Link href="/create" className="text-sm font-semibold text-ig-link hover:text-foreground">
          Поделитесь своим первым фото
        </Link>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <h2 className="text-2xl font-extrabold">Публикаций пока нет</h2>
      </div>
    );
  }

  return (
    <section aria-label="Публикации" className="pt-1">
      <ul className="grid grid-cols-3 gap-0.5 md:gap-1">
        {list.items.map((post) => (
          <li key={post.id}>
            <Link
              href={`/p/${post.id}`}
              className="group relative block aspect-square overflow-hidden bg-secondary"
            >
              <MediaImage
                src={post.image.thumbnailUrl}
                alt={post.caption || `Публикация ${post.author.username}`}
                width={480}
                height={480}
                loading="lazy"
                className="size-full object-cover"
              />
              <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
              {post.type === "video" && (
                <span className="absolute top-2 right-2 text-white drop-shadow">
                  <ReelsIcon className="size-5" />
                  <span className="sr-only">Видео</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {list.failure && (
        <div className="mx-auto max-w-100 py-6">
          <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
        </div>
      )}
      {list.cursor && !list.failure && (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={list.more}
            disabled={list.loading}
            className="h-8 rounded-lg bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80 disabled:opacity-60"
          >
            {list.loading ? "Загрузка…" : "Показать ещё"}
          </button>
        </div>
      )}
    </section>
  );
}
