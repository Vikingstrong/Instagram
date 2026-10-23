"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Comment, Post } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { CommentIcon, MoreHorizontalIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { ConfirmDialog } from "@/components/ui-ig/confirm-dialog";
import { MediaImage } from "@/components/ui-ig/media-image";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";
import type { ApiFailure } from "@/lib/api/client";
import { describeFailure } from "@/lib/api/messages";
import { createPostsClient } from "@/lib/api/posts";
import { replaceLocation } from "@/lib/navigation";

import { CommentForm, CommentList } from "./comments";
import { LikeButton, likesLabel, useLike } from "./like-button";
import { formatPostDate } from "./time";

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; failure: ApiFailure }
  | { state: "ready"; post: Post };

export function PostView() {
  const { id } = useParams<{ id: string }>();
  return <PostContent key={id} id={id} />;
}

// Post details: photo, author, caption and date. The author may delete the
// post after confirming; hidden and deleted posts look the same (404).
function PostContent({ id }: { id: string }) {
  const viewer = useHomeIdentity();
  const checking = useHomeChecking();
  const viewerId = viewer?.id;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    void createPostsClient()
      .get(id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setLoad({ state: "ready", post: result.data.post });
        else if (
          result.failure.kind === "api" &&
          (result.failure.status === 404 || result.failure.status === 400)
        )
          setLoad({ state: "missing" });
        else setLoad({ state: "error", failure: result.failure });
      });
    return () => controller.abort();
  }, [viewerId, id, revision]);

  if (!viewer && !checking)
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">Войдите, чтобы смотреть публикации.</p>
        <Link href="/auth/login" className="font-semibold text-ig-link">
          Войти
        </Link>
      </Centered>
    );
  if (load.state === "loading")
    return (
      <Centered>
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка публикации…
        </p>
      </Centered>
    );
  if (load.state === "missing")
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Публикация недоступна</h1>
        <p className="text-sm text-muted-foreground">
          Возможно, она удалена или у вас нет доступа.{" "}
          <Link href="/" className="text-ig-link">
            Вернуться на главную
          </Link>
        </p>
      </Centered>
    );
  if (load.state === "error")
    return (
      <Centered>
        <ApiErrorNotice failure={load.failure} onRetry={() => setRevision((value) => value + 1)} />
      </Centered>
    );

  const { post } = load;
  const own = post.author.id === viewerId;
  const author = (
    <header className="flex h-15 shrink-0 items-center gap-3 border-b px-4">
      <Link href={`/${post.author.username}`} aria-hidden tabIndex={-1}>
        <Avatar name={post.author.username} src={post.author.avatarUrl} size={32} />
      </Link>
      <Link href={`/${post.author.username}`} className="min-w-0 flex-1 truncate text-sm font-semibold">
        {post.author.username}
      </Link>
      {own && <DeletePost post={post} />}
    </header>
  );

  return (
    <div className="mx-auto w-full max-w-233.75 md:px-5 md:py-8">
      <h1 className="sr-only">Публикация {post.author.username}</h1>
      <article className="flex flex-col border-b md:flex-row md:border">
        <div className="md:hidden">{author}</div>
        <div className="flex items-center justify-center bg-black md:min-w-0 md:flex-[1_1_60%]">
          <MediaImage
            src={post.image.url}
            alt={post.caption || `Публикация ${post.author.username}`}
            width={post.image.width}
            height={post.image.height}
            className="max-h-[min(1350px,85dvh)] w-full object-contain"
          />
        </div>
        <PostSide post={post} header={author} />
      </article>
    </div>
  );
}

// Caption and comments (scrolling on wide screens), then like, counters,
// date and the comment field. On phones the actions come right after the
// photo, as in Instagram.
function PostSide({ post, header }: { post: Post; header: ReactNode }) {
  const like = useLike(post.id, post);
  const [added, setAdded] = useState<Comment[]>([]);
  const created = new Date(post.createdAt);

  return (
    <div className="flex flex-col md:max-h-[min(1350px,85dvh)] md:w-84 md:shrink-0 md:border-l lg:w-100">
      <div className="hidden md:block">{header}</div>
      <div className="flex-1 px-4 py-3 text-sm max-md:order-2 md:overflow-y-auto">
        {post.caption && (
          <p className="mb-2 break-words whitespace-pre-line">
            <Link href={`/${post.author.username}`} className="mr-1 font-semibold">
              {post.author.username}
            </Link>
            {post.caption}
          </p>
        )}
        <CommentList
          postId={post.id}
          added={added}
          onDeleted={(id) => setAdded((list) => list.filter((item) => item.id !== id))}
        />
      </div>
      <div className="flex flex-col gap-1 px-4 pt-3 max-md:order-1 md:border-t">
        <div className="flex items-center gap-4">
          <LikeButton liked={like.liked} onToggle={like.toggle} />
          <button
            type="button"
            aria-label="Комментировать"
            onClick={() => document.getElementById(`comment-${post.id}`)?.focus()}
            className="hover:opacity-60"
          >
            <CommentIcon />
          </button>
        </div>
        {like.error && (
          <p role="alert" className="text-xs text-destructive">
            {like.error}
          </p>
        )}
        <p className="text-sm font-semibold">{likesLabel(like.likeCount)}</p>
        <time
          dateTime={post.createdAt}
          title={created.toLocaleString("ru-RU")}
          className="text-xs text-muted-foreground"
        >
          {formatPostDate(post.createdAt)}
        </time>
      </div>
      <CommentForm
        postId={post.id}
        onAdded={(comment) => setAdded((list) => [...list, comment])}
        className="border-t px-4 py-3 max-md:order-3 md:mt-3"
      />
    </div>
  );
}

function DeletePost({ post }: { post: Post }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const result = await createPostsClient().remove(post.id);
    pending.current = false;
    setBusy(false);
    // Already gone counts as deleted: the profile no longer shows it.
    if (result.ok || (result.failure.kind === "api" && result.failure.status === 404)) {
      replaceLocation(`/${post.author.username}`);
      return;
    }
    setError(describeFailure(result.failure));
  }

  return (
    <>
      <button
        type="button"
        aria-label="Удалить публикацию"
        onClick={() => setConfirm(true)}
        className="rounded-lg p-1 transition-colors hover:bg-secondary"
      >
        <MoreHorizontalIcon />
      </button>
      {confirm && (
        <ConfirmDialog
          title="Удалить публикацию?"
          description="Фото и подпись будут удалены без возможности восстановления."
          media={
            <MediaImage
              src={post.image.thumbnailUrl}
              alt=""
              width={72}
              height={72}
              className="size-18 rounded-md object-cover"
            />
          }
          confirmLabel="Удалить"
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => {
            setConfirm(false);
            setError(undefined);
          }}
        />
      )}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">{children}</div>
  );
}
