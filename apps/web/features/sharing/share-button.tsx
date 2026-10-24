"use client";

import { useEffect, useRef, useState } from "react";
import type { UserSummary } from "@instagram/contracts";
import { DirectIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { openModal } from "@/components/ui-ig/confirm-dialog";
import { useHomeIdentity } from "@/features/auth/home-access";
import { createDirectClient } from "@/lib/api/direct";
import { createSocialClient } from "@/lib/api/social";
import { describeFailure } from "@/lib/api/messages";

type Kind = "post" | "reel" | "story";
export function ShareButton({
  kind,
  contentId,
  initialCount = 0,
  compact = false,
  onOpenChange,
}: {
  kind: Kind;
  contentId: string;
  initialCount?: number;
  compact?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const viewer = useHomeIdentity();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [baseline, setBaseline] = useState(initialCount);
  if (baseline !== initialCount) {
    setBaseline(initialCount);
    setCount(initialCount);
  }
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id: string; kind: Kind; count: number }>
      ).detail;
      if (
        detail?.id === contentId &&
        (detail.kind === "story") === (kind === "story") &&
        Number.isSafeInteger(detail.count) &&
        detail.count >= 0
      )
        setCount(detail.count);
    };
    window.addEventListener("instagram-content-shared", sync);
    return () => window.removeEventListener("instagram-content-shared", sync);
  }, [kind, contentId]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  if (!viewer) return null;
  function change(value: boolean) {
    setOpen(value);
    onOpenChange?.(value);
  }
  return (
    <>
      <span
        className={
          compact
            ? "inline-flex flex-col items-center gap-1"
            : "inline-flex items-center gap-2"
        }
      >
        <button
          type="button"
          aria-label="Поделиться"
          title="Отправить в Direct"
          onClick={() => change(true)}
          className="hover:opacity-60"
        >
          <DirectIcon />
        </button>
        <span
          aria-label={`Поделились: ${count}`}
          className="text-xs tabular-nums"
        >
          {compact
            ? count.toLocaleString("ru-RU")
            : `Поделились: ${count.toLocaleString("ru-RU")}`}
        </span>
      </span>
      {open && (
        <ShareDialog
          key={`${viewer.id}:${kind}:${contentId}`}
          kind={kind}
          contentId={contentId}
          onClose={() => change(false)}
          onShared={(value) => {
            if (value !== null) {
              setCount(value);
              window.dispatchEvent(
                new CustomEvent("instagram-content-shared", {
                  detail: { id: contentId, kind, count: value },
                }),
              );
            }
            change(false);
          }}
        />
      )}
    </>
  );
}

type Recipient = { user: UserSummary; conversationId?: string };
type Results = {
  key: string | null;
  items: Recipient[];
  cursor: string | null;
  loading: boolean;
  error?: string;
};
function ShareDialog({
  kind,
  contentId,
  onClose,
  onShared,
}: {
  kind: Kind;
  contentId: string;
  onClose: () => void;
  onShared: (count: number | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const query = search.trim();
  const [results, setResults] = useState<Results>({
    key: null,
    items: [],
    cursor: null,
    loading: true,
  });
  const [selected, setSelected] = useState<Recipient>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const operation = useRef<{ userId: string; id: string } | undefined>(
    undefined,
  );
  const pending = useRef(false);
  const sending = useRef<AbortController | undefined>(undefined);
  const reading = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    openModal(dialog.current);
    return () => {
      sending.current?.abort();
      reading.current?.abort();
    };
  }, []);
  async function read(
    q: string,
    cursor: string | undefined,
    controller: AbortController,
  ) {
    const result = q
      ? await createSocialClient().search(q, cursor, controller.signal)
      : await createDirectClient().conversations(cursor, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setResults((previous) => ({
        ...previous,
        items: previous.key === q ? previous.items : [],
        cursor: previous.key === q ? previous.cursor : null,
        key: q,
        loading: false,
        error: describeFailure(result.failure),
      }));
      return;
    }
    const items: Recipient[] = q
      ? (result.data.items as UserSummary[]).map((user) => ({ user }))
      : (
          result.data.items as import("@instagram/contracts").Conversation[]
        ).map((conversation) => ({
          user: conversation.peer,
          conversationId: conversation.id,
        }));
    setResults((previous) => ({
      key: q,
      items: cursor
        ? [
            ...previous.items,
            ...items.filter(
              (item) =>
                !previous.items.some((old) => old.user.id === item.user.id),
            ),
          ]
        : items,
      cursor: result.data.nextCursor,
      loading: false,
    }));
  }
  useEffect(() => {
    const controller = new AbortController();
    reading.current = controller;
    const timer = setTimeout(
      () => void read(query, undefined, controller),
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  function more() {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setResults((previous) => ({
      ...previous,
      loading: true,
      error: undefined,
    }));
    void read(query, results.cursor ?? undefined, controller);
  }
  async function send() {
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    sending.current = controller;
    const client = createDirectClient();
    if (operation.current?.userId !== selected.user.id)
      operation.current = { userId: selected.user.id, id: crypto.randomUUID() };
    let conversationId = selected.conversationId;
    if (!conversationId) {
      const opened = await client.open(selected.user.id, controller.signal);
      if (controller.signal.aborted) return;
      if (!opened.ok) {
        pending.current = false;
        setBusy(false);
        setError(describeFailure(opened.failure));
        return;
      }
      conversationId = opened.data.conversation.id;
    }
    const result = await client.share(
      conversationId,
      { clientMessageId: operation.current!.id, kind, contentId, text: "" },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    onShared(result.data.shareCount);
  }
  const current = results.key === query;
  return (
    <dialog
      ref={dialog}
      aria-label="Поделиться"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending.current) onClose();
      }}
      className="fixed inset-0 z-90 m-auto w-[calc(100%-2rem)] max-w-110 rounded-2xl bg-ig-elevated p-0 text-foreground shadow-2xl backdrop:bg-black/65"
    >
      <header className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="font-semibold">Поделиться</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="Закрыть выбор получателя"
          className="text-sm text-muted-foreground"
        >
          Закрыть
        </button>
      </header>
      <div className="p-4">
        <label htmlFor="share-search" className="sr-only">
          Найти получателя
        </label>
        <input
          id="share-search"
          value={search}
          disabled={busy}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Найти пользователя…"
          className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div
        className="max-h-[35dvh] overflow-y-auto px-2"
        aria-busy={!current || results.loading}
      >
        {!current ? (
          <p role="status" className="px-3 py-4 text-sm">
            Загрузка…
          </p>
        ) : (
          <>
            <ul>
              {results.items.map((item) => (
                <li key={item.user.id}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={selected?.user.id === item.user.id}
                    onClick={() => {
                      setSelected(item);
                      setError(undefined);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary aria-pressed:bg-secondary"
                  >
                    <Avatar
                      name={item.user.username}
                      src={item.user.avatarUrl}
                      size={36}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.user.username}
                    </span>
                    {selected?.user.id === item.user.id && (
                      <span className="text-xs font-semibold">Выбран</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {!results.items.length && !results.loading && !results.error && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                {query
                  ? "Никого не найдено."
                  : "Найдите пользователя через поиск."}
              </p>
            )}
            {results.error && (
              <p role="alert" className="px-3 py-2 text-sm text-destructive">
                {results.error}
              </p>
            )}
            {(results.cursor || results.error) && (
              <button
                type="button"
                disabled={busy || results.loading}
                onClick={more}
                className="p-3 text-sm font-semibold"
              >
                {results.error ? "Повторить загрузку" : "Показать ещё"}
              </button>
            )}
          </>
        )}
      </div>
      <footer className="space-y-3 border-t p-4">
        {selected && (
          <p className="truncate text-sm">
            Получатель: <strong>@{selected.user.username}</strong>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Считаются уникальные аккаунты после отправки в Direct. Приватность
          оригинала сохраняется.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => void send()}
          className="w-full rounded-lg bg-ig-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Отправка…" : error ? "Повторить отправку" : "Отправить"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                new URL(
                  `/${kind === "story" ? "stories" : "p"}/${contentId}`,
                  window.location.origin,
                ).href,
              );
              setCopied(true);
            } catch {
              setError(
                "Не удалось скопировать ссылку. Попробуйте отправку в Direct.",
              );
            }
          }}
          className="w-full text-sm font-semibold"
        >
          Копировать ссылку
        </button>
        {copied && (
          <p role="status" className="text-xs text-muted-foreground">
            Ссылка скопирована. Счётчик не изменён.
          </p>
        )}
      </footer>
    </dialog>
  );
}
