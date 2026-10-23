"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { UserSummary } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeIdentity } from "@/features/auth/home-access";
import type { ApiFailure } from "@/lib/api/client";
import { createSocialClient } from "@/lib/api/social";

const MAX_QUERY = 160;
const DEBOUNCE_MS = 300;

type Results = {
  query: string;
  items: UserSummary[];
  cursor: string | null;
};

// User search by username or name. Typing is debounced; a newer query aborts
// the older request so stale results never replace newer ones.
export function UserSearch() {
  const viewer = useHomeIdentity();
  const [text, setText] = useState("");
  const [results, setResults] = useState<Results>();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<ApiFailure>();
  const request = useRef<AbortController | undefined>(undefined);
  const query = text.trim();

  async function fetchPage(q: string, after?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setFailure(undefined);
    const result = await createSocialClient().search(q, after, controller.signal);
    if (controller.signal.aborted) return;
    setLoading(false);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }
    setResults((previous) => ({
      query: q,
      items:
        after && previous?.query === q
          ? [...previous.items, ...result.data.items]
          : result.data.items,
      cursor: result.data.nextCursor,
    }));
  }

  const viewerId = viewer?.id;
  useEffect(() => {
    if (!viewerId || !query) {
      request.current?.abort();
      return;
    }
    const timer = setTimeout(() => void fetchPage(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, viewerId]);
  // An emptied field hides old results and errors without extra state.
  const shown = query ? results : undefined;
  const busy = query !== "" && loading;
  const error = query ? failure : undefined;

  useEffect(() => () => request.current?.abort(), []);

  return (
    <div className="mx-auto flex w-full max-w-150 flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Поисковый запрос</h1>
      <input
        type="search"
        aria-label="Поиск пользователей"
        placeholder="Поиск"
        value={text}
        maxLength={MAX_QUERY}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        className="h-10 w-full rounded-lg bg-secondary px-4 text-sm outline-none"
      />
      {error && (
        <ApiErrorNotice failure={error} onRetry={() => void fetchPage(query)} />
      )}
      {shown && (
        <ul aria-label="Результаты поиска" className="flex flex-col">
          {shown.items.map((user) => (
            <li key={user.id}>
              <Link
                href={`/${user.username}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary"
              >
                <Avatar name={user.username} src={user.avatarUrl} size={44} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-semibold">
                    {user.username}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[user.displayName, user.isPrivate && "Закрытый аккаунт"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Поиск…
        </p>
      )}
      {shown && !busy && shown.items.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Ничего не найдено.
        </p>
      )}
      {shown && !busy && shown.cursor && (
        <button
          type="button"
          onClick={() => void fetchPage(shown.query, shown.cursor ?? undefined)}
          className="py-2 text-sm font-semibold text-ig-link"
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
