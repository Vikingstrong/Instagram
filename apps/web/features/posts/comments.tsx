"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  commentAttachmentRules,
  PostCaptionSchema,
  CommentTextSchema,
  type Comment,
} from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { MediaImage } from "@/components/ui-ig/media-image";
import { Avatar } from "@/components/ui-ig/avatar";
import { ConfirmDialog } from "@/components/ui-ig/confirm-dialog";
import { usePagedList } from "@/features/social/use-paged-list";
import { describeFailure } from "@/lib/api/messages";
import { createPostsClient } from "@/lib/api/posts";
import { cn } from "@/lib/utils";

import { LikeButton, useLike } from "./like-button";

import { timeAgo } from "./time";

// One-line comment field. Empty or space-only text cannot be sent; the text
// stays in the field when the server refuses it.
export function CommentForm({
  postId,
  onAdded,
  className,
  replyTo,
}: {
  postId: string;
  onAdded: (comment: Comment) => void;
  className?: string;
  replyTo?: Comment;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const [image, setImage] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);
  const valid = image
    ? PostCaptionSchema.safeParse(text).success
    : CommentTextSchema.safeParse(text).success;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending.current) return;
    pending.current = true;
    setSending(true);
    setError(undefined);
    const client = createPostsClient();
    const result = image
      ? await client.addMediaComment(postId, image, text, replyTo?.id)
      : await client.addComment(postId, text, replyTo?.id);
    pending.current = false;
    setSending(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setText("");
    setImage(undefined);
    setPreview(undefined);
    if (input.current) input.current.value = "";
    onAdded(result.data.comment);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className={cn("flex flex-col gap-1", className)}
    >
      {replyTo && (
        <p className="text-xs text-muted-foreground">
          Ответ для{" "}
          <span className="font-semibold">@{replyTo.author.username}</span>
        </p>
      )}
      {image && preview && (
        <div className="relative w-fit rounded-lg border p-2">
          <MediaImage
            src={preview}
            alt="Превью вложения"
            className="max-h-44 max-w-full rounded object-contain"
          />
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setImage(undefined);
              setPreview(undefined);
              if (input.current) input.current.value = "";
            }}
            className="mt-2 text-xs font-semibold"
          >
            Убрать вложение
          </button>
        </div>
      )}
      <label className="w-fit cursor-pointer text-xs font-semibold text-muted-foreground">
        Фото / GIF
        <input
          ref={input}
          type="file"
          aria-label="Прикрепить фото или GIF"
          accept={commentAttachmentRules.formats.join(",")}
          disabled={sending}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (
              !(commentAttachmentRules.formats as readonly string[]).includes(
                file.type,
              ) ||
              file.size > commentAttachmentRules.maxBytes
            ) {
              setError("Выберите JPEG, PNG, WebP или GIF до 10 МБ.");
              event.target.value = "";
              return;
            }
            setError(undefined);
            setImage(file);
            setPreview(URL.createObjectURL(file));
          }}
        />
      </label>
      <div className="flex items-center gap-2">
        <label htmlFor={`comment-${replyTo?.id ?? postId}`} className="sr-only">
          {replyTo ? "Ответ" : "Комментарий"}
        </label>
        <textarea
          id={`comment-${replyTo?.id ?? postId}`}
          rows={1}
          value={text}
          disabled={sending}
          placeholder={replyTo ? "Напишите ответ…" : "Добавьте комментарий…"}
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter adds a line, like Instagram.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className="max-h-20 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        {(text.length > 0 || image) && (
          <button
            type="submit"
            disabled={!valid || sending}
            className="text-sm font-semibold text-ig-blue hover:text-foreground disabled:opacity-50"
          >
            {sending ? "…" : "Опубликовать"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export function CommentItem({
  comment,
  onDeleted,
  onReply,
  onReplyCountChange,
}: {
  comment: Comment;
  onDeleted: (id: string) => void;
  onReply?: (target: Comment) => void;
  onReplyCountChange?: (delta: number) => void;
}) {
  const like = useLike(comment.id, comment, "comment");
  const [replyTo, setReplyTo] = useState<Comment>();
  const [expanded, setExpanded] = useState(false);
  const [addedReplies, setAddedReplies] = useState<Comment[]>([]);
  const [replyCount, setReplyCount] = useState(comment.replyCount);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    setBusy(true);
    setError(undefined);
    const result = await createPostsClient().removeComment(comment.id);
    setBusy(false);
    // Already deleted elsewhere counts as done.
    if (
      result.ok ||
      (result.failure.kind === "api" && result.failure.status === 404)
    ) {
      setConfirm(false);
      if (!comment.parentId) onReplyCountChange?.(-replyCount);
      onDeleted(comment.id);
      return;
    }
    setError(describeFailure(result.failure));
  }

  const { author } = comment;
  return (
    <li className="py-2">
      <div className="group flex gap-3">
        <Link
          href={`/${author.username}`}
          aria-hidden
          tabIndex={-1}
          className="shrink-0"
        >
          <Avatar name={author.username} src={author.avatarUrl} size={32} />
        </Link>
        <div className="min-w-0 flex-1 text-sm">
          <p className="break-words whitespace-pre-line">
            <Link href={`/${author.username}`} className="mr-1 font-semibold">
              {author.username}
            </Link>
            {comment.replyTo && (
              <span className="mr-1 text-muted-foreground">
                Ответ для{" "}
                <Link
                  href={`/${comment.replyTo.username}`}
                  className="font-semibold"
                >
                  @{comment.replyTo.username}
                </Link>{" "}
                ·{" "}
              </span>
            )}
            {comment.text}
          </p>
          {comment.attachment && (
            <a
              href={comment.attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block w-fit max-w-full"
            >
              <MediaImage
                src={comment.attachment.url}
                alt="Вложение комментария"
                width={comment.attachment.width}
                height={comment.attachment.height}
                loading="lazy"
                className="max-h-72 max-w-full rounded-lg object-contain"
              />
            </a>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <time dateTime={comment.createdAt}>
              {timeAgo(comment.createdAt)}
            </time>
            <span>{like.likeCount} нравится</span>
            <button
              type="button"
              className="font-semibold hover:text-foreground"
              onClick={() => (onReply ? onReply(comment) : setReplyTo(comment))}
            >
              Ответить
            </button>
            {comment.canDelete && (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                aria-label={`Удалить комментарий ${author.username}`}
                className="font-semibold hover:text-foreground"
              >
                Удалить
              </button>
            )}
          </div>
        </div>
        <div className="shrink-0 self-start [&_svg]:size-4">
          <LikeButton liked={like.liked} onToggle={like.toggle} />
        </div>
      </div>
      {like.error && (
        <p role="alert" className="text-xs text-destructive">
          {like.error}
        </p>
      )}
      {!comment.parentId && (
        <div className="ml-11">
          {!expanded && replyCount > 0 && (
            <button
              type="button"
              className="py-2 text-xs font-semibold text-muted-foreground"
              onClick={() => setExpanded(true)}
            >
              Посмотреть ответы ({replyCount})
            </button>
          )}
          {expanded && (
            <ReplyList
              root={comment}
              added={addedReplies}
              onReply={setReplyTo}
              onDeleted={(id) => {
                setAddedReplies((items) =>
                  items.filter((item) => item.id !== id),
                );
                setReplyCount((count) => Math.max(0, count - 1));
                onReplyCountChange?.(-1);
              }}
            />
          )}
          {replyTo && (
            <div className="border-l pl-3">
              <button
                type="button"
                className="text-xs text-muted-foreground"
                onClick={() => setReplyTo(undefined)}
              >
                Отменить ответ
              </button>
              <CommentForm
                key={replyTo.id}
                postId={comment.postId}
                replyTo={replyTo}
                onAdded={(reply) => {
                  setAddedReplies((items) => [...items, reply]);
                  setReplyCount((count) => count + 1);
                  onReplyCountChange?.(1);
                  setExpanded(true);
                  setReplyTo(undefined);
                }}
              />
            </div>
          )}
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="Удалить комментарий?"
          description={
            !comment.parentId && replyCount > 0
              ? "Ответы под этим комментарием тоже будут удалены."
              : undefined
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
    </li>
  );
}

function ReplyList({
  root,
  added,
  onReply,
  onDeleted,
}: {
  root: Comment;
  added: Comment[];
  onReply: (target: Comment) => void;
  onDeleted: (id: string) => void;
}) {
  const list = usePagedList<Comment>(
    (cursor, signal) => createPostsClient().replies(root.id, cursor, signal),
    root.id,
  );
  const own = new Set(added.map((item) => item.id));
  const items = [...list.items.filter((item) => !own.has(item.id)), ...added];
  return (
    <>
      {list.failure && (
        <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
      )}
      {list.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Загрузка ответов…
        </p>
      )}
      <ul aria-label={`Ответы на комментарий ${root.author.username}`}>
        {items.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            onReply={onReply}
            onDeleted={(id) => {
              list.remove((item) => item.id !== id);
              onDeleted(id);
            }}
          />
        ))}
      </ul>
      {list.cursor && !list.failure && (
        <button
          type="button"
          disabled={list.loading}
          onClick={list.more}
          className="py-2 text-xs font-semibold text-muted-foreground"
        >
          Показать ещё ответы
        </button>
      )}
    </>
  );
}

// Comments under a post, oldest first with "load more". Comments added here
// are kept separately at the end, so a later page never shows them twice.
export function CommentList({
  postId,
  added,
  onDeleted,
}: {
  postId: string;
  added: Comment[];
  onDeleted: (id: string) => void;
}) {
  const list = usePagedList<Comment>(
    (cursor, signal) => createPostsClient().comments(postId, cursor, signal),
    postId,
  );
  const own = new Set(added.map((comment) => comment.id));
  const items = [
    ...list.items.filter((comment) => !own.has(comment.id)),
    ...added,
  ];

  return (
    <section aria-label="Комментарии">
      {list.failure && (
        <ApiErrorNotice failure={list.failure} onRetry={list.retry} />
      )}
      {list.loading && list.items.length === 0 && (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          Загрузка комментариев…
        </p>
      )}
      {list.cursor && !list.failure && (
        <button
          type="button"
          onClick={list.more}
          disabled={list.loading}
          className="py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {list.loading ? "Загрузка…" : "Показать ещё комментарии"}
        </button>
      )}
      <ul>
        {items.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onDeleted={(id) => {
              list.remove((item) => item.id !== id);
              onDeleted(id);
            }}
          />
        ))}
      </ul>
      {!list.loading && !list.failure && items.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">
          Комментариев пока нет.
        </p>
      )}
    </section>
  );
}
