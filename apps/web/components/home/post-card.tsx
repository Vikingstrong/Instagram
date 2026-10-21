import Link from "next/link";

import {
  BookmarkIcon,
  CommentIcon,
  DirectIcon,
  HeartIcon,
  MoreHorizontalIcon,
  VerifiedBadge,
} from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { cn } from "@/lib/utils";

import type { MockPost } from "./mock-data";

const actionClass = "transition-opacity hover:opacity-60";

// One feed item: media with an overlaid header, actions and caption below.
export function PostCard({ post }: { post: MockPost }) {
  const { author } = post;

  return (
    <article className="border-b pb-4 md:pb-5">
      <div className="relative overflow-hidden md:rounded-sm md:border">
        <div
          role="img"
          aria-label={`Публикация ${author.username}`}
          className={cn("aspect-4/5 w-full", post.mediaClassName)}
        />

        <header className="absolute inset-x-0 top-0 flex items-center gap-3 bg-linear-to-b from-black/45 to-transparent px-3 pt-3 pb-8 text-white">
          <Avatar name={author.username} size={32} storyRing />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="flex items-center gap-1 text-sm">
              <Link href={`/${author.username}`} className="font-semibold">
                {author.username}
              </Link>
              {author.verified && <VerifiedBadge />}
              <span className="text-white/80">• {post.postedAgo}</span>
            </p>
            <p className="truncate text-xs text-white/90">{post.audio}</p>
          </div>
          <button type="button" className="text-sm font-semibold hover:opacity-80">
            Подписаться
          </button>
          <button type="button" aria-label="Дополнительно" className="hover:opacity-80">
            <MoreHorizontalIcon />
          </button>
        </header>
      </div>

      <div className="flex flex-col gap-2 px-3 pt-3 md:px-0">
        <div className="flex items-center gap-4">
          <button type="button" aria-label="Нравится" className={actionClass}>
            <HeartIcon />
          </button>
          <button type="button" aria-label="Комментировать" className={actionClass}>
            <CommentIcon />
          </button>
          <button type="button" aria-label="Поделиться" className={actionClass}>
            <DirectIcon />
          </button>
          <button
            type="button"
            aria-label="Сохранить"
            className={cn(actionClass, "ml-auto")}
          >
            <BookmarkIcon />
          </button>
        </div>

        <p className="text-sm font-semibold">{post.likes} отметок «Нравится»</p>
        <p className="text-sm">
          <span className="font-semibold">{author.username}</span> {post.caption}
        </p>
        <button
          type="button"
          className="self-start text-sm text-muted-foreground"
        >
          Посмотреть все комментарии ({post.comments})
        </button>
        <input
          type="text"
          aria-label="Добавьте комментарий"
          placeholder="Добавьте комментарий…"
          className="bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </article>
  );
}
