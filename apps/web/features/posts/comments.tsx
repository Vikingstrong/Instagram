"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { CommentTextSchema, type Comment } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { Avatar } from "@/components/ui-ig/avatar";
import { ConfirmDialog } from "@/components/ui-ig/confirm-dialog";
import { usePagedList } from "@/features/social/use-paged-list";
import { describeFailure } from "@/lib/api/messages";
import { createPostsClient } from "@/lib/api/posts";
import { cn } from "@/lib/utils";

import { timeAgo } from "./time";

// One-line comment field. Empty or space-only text cannot be sent; the text
// stays in the field when the server refuses it.
export function CommentForm({
  postId,
  onAdded,
  className,
}: {
  postId: string;
  onAdded: (comment: Comment) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const valid = CommentTextSchema.safeParse(text).success;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending.current) return;
    pending.current = true;
    setSending(true);
    setError(undefined);
    const result = await createPostsClient().addComment(postId, text);
    pending.current = false;
    setSending(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setText("");
    onAdded(result.data.comment);
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={`comment-${postId}`} className="sr-only">
          Комментарий
        </label>
        <textarea
          id={`comment-${postId}`}
          rows={1}
          value={text}
          disabled={sending}
          placeholder="Добавьте комментарий…"
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
        {text.length > 0 && (
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
}: {
  comment: Comment;
  onDeleted: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    setBusy(true);
    setError(undefined);
    const result = await createPostsClient().removeComment(comment.id);
    setBusy(false);
    // Already deleted elsewhere counts as done.
    if (result.ok || (result.failure.kind === "api" && result.failure.status === 404)) {
      setConfirm(false);
      onDeleted(comment.id);
      return;
    }
    setError(describeFailure(result.failure));
  }

  const { author } = comment;
  return (
    <li className="group flex gap-3 py-2">
      <Link href={`/${author.username}`} aria-hidden tabIndex={-1} className="shrink-0">
        <Avatar name={author.username} src={author.avatarUrl} size={32} />
      </Link>
      <div className="min-w-0 flex-1 text-sm">
        <p className="break-words whitespace-pre-line">
          <Link href={`/${author.username}`} className="mr-1 font-semibold">
            {author.username}
          </Link>
          {comment.text}
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <time dateTime={comment.createdAt}>{timeAgo(comment.createdAt)}</time>
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
      {confirm && (
        <ConfirmDialog
          title="Удалить комментарий?"
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
  const items = [...list.items.filter((comment) => !own.has(comment.id)), ...added];

  return (
    <section aria-label="Комментарии">
      {list.failure && <ApiErrorNotice failure={list.failure} onRetry={list.retry} />}
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
        <p className="py-2 text-sm text-muted-foreground">Комментариев пока нет.</p>
      )}
    </section>
  );
}
