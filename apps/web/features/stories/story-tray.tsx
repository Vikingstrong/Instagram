"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoryGroup } from "@instagram/contracts";
import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeIdentity, useHomeChecking } from "@/features/auth/home-access";
import { createStoriesClient } from "@/lib/api/stories";
import { describeFailure } from "@/lib/api/messages";

export function StoryTray() {
  const user = useHomeIdentity();
  return user?.emailVerified ? <Tray key={user.id} /> : null;
}
function Tray() {
  const [items, setItems] = useState<StoryGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [error, setError] = useState<string>();
  const [revision, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const checking = useHomeChecking();
  useEffect(() => {
    const controller = new AbortController();
    void createStoriesClient()
      .feed(undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setItems(result.data.items);
          setCursor(result.data.nextCursor);
          setError(undefined);
        } else setError(describeFailure(result.failure));
      });
    const update = () => refresh((v) => v + 1);
    window.addEventListener("focus", update);
    const timer = setInterval(update, 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [revision]);
  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    const result = await createStoriesClient().feed(cursor);
    setBusy(false);
    if (result.ok) {
      setItems((old) => [
        ...old,
        ...result.data.items.filter(
          (n) => !old.some((o) => o.author.id === n.author.id),
        ),
      ]);
      setCursor(result.data.nextCursor);
    } else setError(describeFailure(result.failure));
  }
  return (
    <section aria-label="Истории" className="flex flex-col gap-2 px-2">
      <div className="flex items-start gap-4 overflow-x-auto pb-2">
        <Link
          href="/stories/create"
          className="flex shrink-0 flex-col items-center gap-2 text-xs"
        >
          <span
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-full border-2 border-dashed text-3xl"
          >
            +
          </span>
          Ваша история
        </Link>
        {!checking &&
          items.map((group) => (
            <AuthorStory key={group.author.id} group={group} />
          ))}
        {cursor && (
          <button
            type="button"
            onClick={() => void more()}
            disabled={busy}
            className="shrink-0 self-center text-sm text-ig-link"
          >
            Ещё истории
          </button>
        )}
      </div>
      {error && (
        <button
          type="button"
          onClick={() => refresh((v) => v + 1)}
          className="text-left text-xs text-muted-foreground"
        >
          Не удалось загрузить истории. Повторить
        </button>
      )}
    </section>
  );
}
function AuthorStory({ group }: { group: StoryGroup }) {
  return (
    <Link
      href={`/stories/user/${group.author.id}`}
      aria-label={`Истории ${group.author.username}${group.hasUnseen ? ", новые" : ", просмотрены"}`}
      className="flex w-18 shrink-0 flex-col items-center gap-1 text-xs"
    >
      <Avatar
        name={group.author.username}
        src={group.author.avatarUrl}
        size={56}
        storyRing={group.hasUnseen}
        className={
          !group.hasUnseen
            ? "ring-2 ring-muted ring-offset-4 ring-offset-background"
            : ""
        }
      />
      <span className="w-full truncate text-center">
        {group.author.username}
      </span>
    </Link>
  );
}
