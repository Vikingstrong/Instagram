"use client";

import Link from "next/link";
import { ShareButton } from "@/features/sharing/share-button";
import { useEffect, useRef, useState } from "react";
import type { Post } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { CommentIcon, ReelsIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { VideoPlayer } from "@/components/ui-ig/video-player";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";
import { usePagedList } from "@/features/social/use-paged-list";
import { createPostsClient } from "@/lib/api/posts";

import { LikeButton, useLike } from "./like-button";

// FR-10 Reels: accessible video posts, newest first, one per screen with
// snap scrolling. Only the reel in view plays (muted until the viewer turns
// sound on); the next page loads when the viewer nears the end.
export function Reels() {
  const viewer = useHomeIdentity();
  const checking = useHomeChecking();
  const [shownId, setShownId] = useState(viewer?.id);
  if (viewer && viewer.id !== shownId) setShownId(viewer.id);

  if (!shownId && !checking)
    return (
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Войдите, чтобы смотреть Reels.
        </p>
        <Link href="/auth/login" className="font-semibold text-ig-link">
          Войти
        </Link>
      </div>
    );
  if (!shownId) return null;
  return <ReelsList key={shownId} viewerId={shownId} />;
}

function ReelsList({ viewerId }: { viewerId: string }) {
  const list = usePagedList<Post>(
    (cursor, signal) => createPostsClient().reels(cursor, signal),
    viewerId,
  );
  const [muted, setMuted] = useState(true);

  function reached(index: number) {
    // Two reels before the end: fetch the next page in time.
    if (index >= list.items.length - 2 && list.cursor && !list.loading)
      list.more();
  }

  if (list.items.length === 0) {
    if (list.failure)
      return (
        <div className="m-auto max-w-100 p-6">
          <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
        </div>
      );
    if (list.loading)
      return (
        <p role="status" className="m-auto text-sm text-muted-foreground">
          Загрузка Reels…
        </p>
      );
    return (
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-full border-2 border-foreground">
          <ReelsIcon className="size-10" />
        </span>
        <h1 className="text-xl font-semibold">Reels пока нет</h1>
        <p className="text-sm text-muted-foreground">
          Здесь появятся видео ваших подписок и открытых аккаунтов.
        </p>
        <Link
          href="/create"
          className="text-sm font-semibold text-ig-link hover:text-foreground"
        >
          Опубликовать видео
        </Link>
      </div>
    );
  }

  return (
    <section
      aria-label="Reels"
      className="h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] snap-y snap-mandatory overflow-y-auto md:h-dvh"
    >
      <h1 className="sr-only">Reels</h1>
      {list.items.map((post, index) => (
        <Reel
          key={post.id}
          post={post}
          muted={muted}
          onToggleSound={() => setMuted((value) => !value)}
          onActive={() => reached(index)}
        />
      ))}
      {list.failure && (
        <div className="flex h-40 snap-start items-center justify-center p-6">
          <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
        </div>
      )}
      {!list.cursor && !list.failure && (
        <p className="flex h-24 snap-end items-center justify-center text-sm text-muted-foreground">
          Вы посмотрели все Reels.
        </p>
      )}
    </section>
  );
}

function Reel({
  post,
  muted,
  onToggleSound,
  onActive,
}: {
  post: Post;
  muted: boolean;
  onToggleSound: () => void;
  onActive: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(onActive);
  const like = useLike(post.id, post);
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    active.current = onActive;
  });

  // Plays while at least 60 % of the reel is on screen, pauses otherwise.
  useEffect(() => {
    const element = video.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void element.play().catch(() => undefined);
          active.current();
        } else element.pause();
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  if (!post.video) return null;
  const { author } = post;
  return (
    <article
      aria-label={`Reels ${author.username}`}
      className="relative flex h-full snap-start items-center justify-center bg-black"
    >
      <VideoPlayer
        ref={video}
        src={post.video.url}
        poster={post.image.url}
        label={post.caption || `Reels ${author.username}`}
        loop
        muted={muted}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onClick={(event) => {
          const element = event.currentTarget;
          if (element.paused) void element.play().catch(() => undefined);
          else element.pause();
        }}
        className="h-full max-w-full cursor-pointer object-contain md:aspect-9/16 md:object-cover"
      />
      {paused && (
        <span
          aria-hidden
          className="pointer-events-none absolute text-5xl text-white/80"
        >
          ▶
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 bg-linear-to-t from-black/70 to-transparent p-4 pr-20 text-white">
        <div className="pointer-events-auto min-w-0 flex-1">
          <Link
            href={`/${author.username}`}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Avatar name={author.username} src={author.avatarUrl} size={32} />
            {author.username}
          </Link>
          {post.caption && (
            <p className="mt-2 line-clamp-2 text-sm whitespace-pre-line">
              {post.caption}
            </p>
          )}
        </div>
      </div>

      <div className="absolute right-3 bottom-6 flex flex-col items-center gap-4 text-white">
        <div className="flex flex-col items-center gap-1">
          <LikeButton liked={like.liked} onToggle={like.toggle} />
          <span className="text-xs">
            {like.likeCount.toLocaleString("ru-RU")}
          </span>
        </div>
        <Link
          href={`/p/${post.id}`}
          aria-label={`Комментарии (${post.commentCount})`}
          className="flex flex-col items-center gap-1"
        >
          <CommentIcon />
          <span className="text-xs">
            {post.commentCount.toLocaleString("ru-RU")}
          </span>
        </Link>
        <ShareButton
          kind="reel"
          contentId={post.id}
          initialCount={post.shareCount}
          compact
          onOpenChange={(open) => {
            if (open) video.current?.pause();
          }}
        />
        <button
          type="button"
          onClick={onToggleSound}
          aria-label={muted ? "Включить звук" : "Выключить звук"}
          aria-pressed={!muted}
          className="rounded-full bg-black/40 px-2 py-1 text-xs font-semibold"
        >
          {muted ? "Звук выкл." : "Звук вкл."}
        </button>
        {like.error && (
          <p role="alert" className="max-w-24 text-center text-xs">
            {like.error}
          </p>
        )}
      </div>
    </article>
  );
}
