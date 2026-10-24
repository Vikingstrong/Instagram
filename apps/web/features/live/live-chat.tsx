"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import {
  LiveCommentTextSchema,
  liveRules,
  type LiveComment,
  type LiveViewerAccess,
} from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { createLivesClient } from "@/lib/api/lives";
import { describeFailure } from "@/lib/api/messages";

import { useLiveNotices } from "./live-notices";
import { ModerationMenu, canModerate, muteTerm, type Moderation } from "./moderation";

const POLL_MS = 2000;
const KEEP = 200;

// Merges by id in chat order; the screen keeps the latest lines only.
export function mergeComments(current: LiveComment[], incoming: LiveComment[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()]
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt),
    )
    .slice(-KEEP);
}

// Live chat (FR-12): the latest lines, read again after an SSE notice or
// a short poll. After the stream ends the lines stay on screen read-only.
// moderation: names become a menu for the host and moderators; muted: the
// caller may read but not write.
export function LiveChat({
  liveId,
  open,
  selfId,
  moderation,
  muted,
}: {
  liveId: string;
  open: boolean;
  selfId?: string;
  moderation?: Moderation;
  muted?: LiveViewerAccess["muted"];
}) {
  const [notice, setNotice] = useState<string>();
  const [items, setItems] = useState<LiveComment[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const pending = useRef<{ id: string; text: string } | undefined>(undefined);
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  async function load() {
    if (busy.current) return;
    busy.current = true;
    try {
      // The latest page replaces the list: lines removed by moderation
      // (a ban) disappear for everyone.
      const result = await createLivesClient().comments(liveId);
      if (result.ok) setItems(result.data.items);
    } finally {
      busy.current = false;
    }
  }
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    if (!open) return;
    void loader.current();
    const timer = setInterval(() => void loader.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, liveId]);
  useLiveNotices((id) => {
    if (open && id === liveId) void loader.current();
  });
  useEffect(() => {
    const node = list.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [items]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!LiveCommentTextSchema.safeParse(value).success) {
      setError(`Сообщение — одна строка до ${liveRules.commentMaxLength} символов.`);
      return;
    }
    // A retry of the same text reuses its id, so it is not posted twice.
    if (pending.current?.text !== value)
      pending.current = { id: crypto.randomUUID(), text: value };
    setSending(true);
    setError(undefined);
    const result = await createLivesClient().comment(liveId, pending.current);
    setSending(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    pending.current = undefined;
    pinned.current = true;
    setText("");
    setItems((current) => mergeComments(current, [result.data.comment]));
  }

  return (
    <aside
      aria-label="Чат эфира"
      className="flex h-[calc(46dvh-6rem-env(safe-area-inset-bottom))] min-h-44 flex-col border-t md:h-[min(86dvh,820px)] md:w-80 md:rounded-2xl md:border"
    >
      <h2 className="border-b px-4 py-3 text-sm font-semibold">Комментарии</h2>
      <ol
        ref={list}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
        }}
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      >
        {items.length === 0 && (
          <li className="m-auto text-center text-xs text-muted-foreground">
            {open ? "Пока нет комментариев." : "Комментариев не было."}
          </li>
        )}
        {items.map((item) => (
          <li key={item.id} className="flex gap-2 text-sm">
            <Avatar name={item.author.username} src={item.author.avatarUrl} size={24} />
            <p className="min-w-0 break-words">
              {canModerate(moderation) &&
              item.author.id !== selfId &&
              item.author.id !== moderation!.hostId ? (
                <ModerationMenu moderation={moderation!} user={item.author} onDone={setNotice} />
              ) : (
                <span className="mr-1.5 font-semibold">{item.author.username}</span>
              )}
              {item.text}
            </p>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="px-4 pb-2 text-xs text-emerald-400">
          {notice}
        </p>
      )}
      {open && muted ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Вам запрещено писать в этом эфире {muteTerm(muted)}.
        </p>
      ) : open ? (
        <form onSubmit={submit} className="flex items-center gap-2 border-t px-3 py-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={liveRules.commentMaxLength * 2}
            placeholder="Добавьте комментарий…"
            aria-label="Комментарий к эфиру"
            className="h-9 min-w-0 flex-1 rounded-full border bg-transparent px-4 text-sm outline-none focus:border-foreground/40"
          />
          <button
            type="submit"
            aria-label="Отправить комментарий"
            disabled={sending || !text.trim()}
            className="rounded-full p-2 text-ig-blue hover:bg-secondary disabled:opacity-40"
          >
            <Send size={18} />
          </button>
        </form>
      ) : (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Эфир завершён — чат закрыт.
        </p>
      )}
    </aside>
  );
}
