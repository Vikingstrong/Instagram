"use client";

import Link from "next/link";
import { useState } from "react";
import type { Comment, Post } from "@instagram/contracts";

import { CommentIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { MediaImage } from "@/components/ui-ig/media-image";

import { CommentForm, CommentItem } from "./comments";
import { LikeButton, likesLabel, useLike } from "./like-button";
import { PostMedia } from "./post-media";
import { timeAgo } from "./time";

// One feed item: author, photo, like, counters, caption and a comment field.
// Comments written here appear under the caption; the full list is on the
// post page.
export function FeedPost({ post }: { post: Post }) {
  const like = useLike(post.id, post);
  const [comments, setComments] = useState(post.commentCount);
  const [mine, setMine] = useState<Comment[]>([]);
  const { author } = post;
  const href = `/p/${post.id}`;

  return (
    <article aria-labelledby={`post-${post.id}`} className="border-b pb-4 md:pb-5">
      <header className="flex items-center gap-3 px-3 pb-3 md:px-0">
        <Link href={`/${author.username}`} aria-hidden tabIndex={-1}>
          <Avatar name={author.username} src={author.avatarUrl} size={32} />
        </Link>
        <p className="min-w-0 flex-1 truncate text-sm">
          <Link id={`post-${post.id}`} href={`/${author.username}`} className="font-semibold">
            {author.username}
          </Link>
          <span className="text-muted-foreground">
            {" • "}
            <Link href={href}>
              <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
            </Link>
          </span>
        </p>
      </header>

      {post.type === "video" ? (
        // A video keeps its own controls, so it is not wrapped in a link.
        <div className="overflow-hidden bg-black md:rounded-sm md:border">
          <PostMedia post={post} className="max-h-146.25" />
        </div>
      ) : (
        <Link href={href} className="block overflow-hidden bg-black md:rounded-sm md:border">
          <MediaImage
            src={post.image.url}
            alt={post.caption || `Публикация ${author.username}`}
            width={post.image.width}
            height={post.image.height}
            loading="lazy"
            className="max-h-146.25 w-full object-contain"
          />
        </Link>
      )}

      <div className="flex flex-col gap-2 px-3 pt-3 md:px-0">
        <div className="flex items-center gap-4">
          <LikeButton liked={like.liked} onToggle={like.toggle} />
          <Link href={href} aria-label="Комментарии" className="transition-opacity hover:opacity-60">
            <CommentIcon />
          </Link>
        </div>
        {like.error && (
          <p role="alert" className="text-xs text-destructive">
            {like.error}
          </p>
        )}
        <p className="text-sm font-semibold">{likesLabel(like.likeCount)}</p>
        {post.caption && (
          <p className="text-sm break-words whitespace-pre-line">
            <Link href={`/${author.username}`} className="mr-1 font-semibold">
              {author.username}
            </Link>
            {post.caption}
          </p>
        )}
        {comments > 0 && (
          <Link href={href} className="self-start text-sm text-muted-foreground">
            {comments === 1 ? "Посмотреть 1 комментарий" : `Посмотреть все комментарии (${comments})`}
          </Link>
        )}
        {mine.length > 0 && (
          <ul>
            {mine.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onReplyCountChange={(delta) => setComments((count) => Math.max(0, count + delta))}
                onDeleted={(id) => {
                  setMine((list) => list.filter((item) => item.id !== id));
                  setComments((count) => Math.max(0, count - 1));
                }}
              />
            ))}
          </ul>
        )}
        <CommentForm
          postId={post.id}
          onAdded={(comment) => {
            setMine((list) => [...list, comment]);
            setComments((count) => count + 1);
          }}
        />
      </div>
    </article>
  );
}
