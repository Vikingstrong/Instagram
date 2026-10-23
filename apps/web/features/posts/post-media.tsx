"use client";

import type { Post } from "@instagram/contracts";

import { MediaImage } from "@/components/ui-ig/media-image";
import { VideoPlayer } from "@/components/ui-ig/video-player";
import { cn } from "@/lib/utils";

const label = (post: Post) => post.caption || `Публикация ${post.author.username}`;

// The photo or video of a post. A video still being prepared (or one that
// failed) is only ever shown to its author: its files are not served yet,
// so a placeholder explains the state instead.
export function PostMedia({ post, className }: { post: Post; className?: string }) {
  if (post.status !== "ready")
    return (
      <div
        role="status"
        className={cn(
          "flex aspect-video w-full flex-col items-center justify-center gap-3 bg-black px-6 text-center text-sm text-white",
          className,
        )}
      >
        {post.status === "processing" ? (
          <>
            <span
              aria-hidden
              className="size-8 animate-spin rounded-full border-2 border-white border-r-transparent"
            />
            Видео обрабатывается. Публикация появится у подписчиков, когда будет готова.
          </>
        ) : (
          "Не удалось обработать видео. Удалите публикацию и загрузите видео снова."
        )}
      </div>
    );
  if (post.type === "video" && post.video)
    return (
      <VideoPlayer
        src={post.video.url}
        poster={post.image.url}
        label={label(post)}
        controls
        width={post.image.width}
        height={post.image.height}
        className={cn("w-full bg-black object-contain", className)}
      />
    );
  return (
    <MediaImage
      src={post.image.url}
      alt={label(post)}
      width={post.image.width}
      height={post.image.height}
      className={cn("w-full object-contain", className)}
    />
  );
}
