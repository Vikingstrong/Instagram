"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import {
  ChevronRightIcon,
  CloseIcon,
  VerifiedBadge,
} from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";

import type { MockUser } from "./mock-data";

const CARD_STEP = 164; // card width 152 + gap 12

// Horizontal "Рекомендации для вас" strip at the top of the feed.
export function SuggestionsCarousel({ users }: { users: MockUser[] }) {
  const scroller = useRef<HTMLUListElement>(null);
  const [visible, setVisible] = useState(users);

  if (visible.length === 0) {
    return null;
  }

  const scrollNext = () =>
    scroller.current?.scrollBy({ left: CARD_STEP * 2, behavior: "smooth" });

  return (
    <section aria-labelledby="suggestions-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-4 md:px-0">
        <h2 id="suggestions-title" className="text-base font-semibold">
          Рекомендации для вас
        </h2>
        <Link
          href="/explore/people"
          className="text-sm font-semibold text-ig-link hover:text-foreground"
        >
          Смотреть все
        </Link>
      </div>

      <div className="relative">
        <ul
          ref={scroller}
          className="scrollbar-none flex snap-x gap-3 overflow-x-auto px-4 md:px-0"
        >
          {visible.map((user) => (
            <li
              key={user.username}
              className="relative flex w-38 shrink-0 snap-start flex-col items-center rounded-lg border bg-card px-3 pt-6 pb-3"
            >
              <button
                type="button"
                aria-label={`Скрыть ${user.username}`}
                onClick={() =>
                  setVisible((list) =>
                    list.filter((u) => u.username !== user.username),
                  )
                }
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              >
                <CloseIcon className="size-4" />
              </button>

              <Avatar name={user.username} size={92} />

              <p className="mt-3 flex w-full items-center justify-center gap-1 text-sm font-semibold">
                <span className="truncate">{user.displayName}</span>
                {user.verified && <VerifiedBadge />}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Популярное</p>

              <button data-auth-required
                type="button"
                className="mt-6 h-8 w-full rounded-lg bg-ig-blue text-sm font-semibold text-white transition-colors hover:bg-ig-blue-hover"
              >
                Подписаться
              </button>
            </li>
          ))}
        </ul>

        {visible.length > 3 && (
          <button
            type="button"
            aria-label="Показать ещё"
            onClick={scrollNext}
            className="absolute top-1/2 right-2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-md md:flex"
          >
            <ChevronRightIcon className="size-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </section>
  );
}
