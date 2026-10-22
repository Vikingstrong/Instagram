"use client";

import Link from "next/link";
import { useRef } from "react";

import { ChevronRightIcon, CloseIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { FollowButton } from "@/features/social/follow-button";
import { useSuggestions } from "@/features/social/suggestions";

const CARD_STEP = 164; // card width 152 + gap 12

// Horizontal "Рекомендации для вас" strip at the top of the feed. Real
// accounts from the API; the strip disappears when there is nothing to show.
export function SuggestionsCarousel() {
  const scroller = useRef<HTMLUListElement>(null);
  const suggestions = useSuggestions();

  if (!suggestions) {
    return null;
  }
  const { items, follow, setFollow, dismiss } = suggestions;

  const scrollNext = () =>
    scroller.current?.scrollBy({ left: CARD_STEP * 2, behavior: "smooth" });

  return (
    <section aria-labelledby="suggestions-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-4 md:px-0">
        <h2 id="suggestions-title" className="text-base font-semibold">
          Рекомендации для вас
        </h2>
      </div>

      <div className="relative">
        <ul
          ref={scroller}
          className="scrollbar-none flex snap-x gap-3 overflow-x-auto px-4 md:px-0"
        >
          {items.map((user) => (
            <li
              key={user.id}
              className="relative flex w-38 shrink-0 snap-start flex-col items-center rounded-lg border bg-card px-3 pt-6 pb-3"
            >
              <button
                type="button"
                aria-label={`Скрыть ${user.username}`}
                onClick={() => dismiss(user.id)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              >
                <CloseIcon className="size-4" />
              </button>

              <Link href={`/${user.username}`} className="flex flex-col items-center">
                <Avatar name={user.username} size={92} />
                <span className="mt-3 w-full truncate text-center text-sm font-semibold">
                  {user.displayName || user.username}
                </span>
              </Link>
              <p className="mt-1 w-full truncate text-center text-xs text-muted-foreground">
                {user.displayName ? user.username : "Рекомендации для вас"}
              </p>

              <FollowButton
                key={follow[user.id] ?? "none"}
                userId={user.id}
                username={user.username}
                initial={follow[user.id] ?? "none"}
                onChange={(state) => setFollow(user.id, state)}
                className="mt-6 w-full"
              />
            </li>
          ))}
        </ul>

        {items.length > 3 && (
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
