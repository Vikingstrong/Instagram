"use client";

import Link from "next/link";

import { useHomeIdentity } from "@/features/auth/home-access";
import { Avatar, DefaultAvatar } from "@/components/ui-ig/avatar";
import { FollowButton } from "@/features/social/follow-button";
import { useSuggestions } from "@/features/social/suggestions";

const footerLinks = [
  "Информация",
  "Помощь",
  "Пресса",
  "API",
  "Вакансии",
  "Конфиденциальность",
  "Условия",
  "Язык",
];

const linkButtonClass =
  "shrink-0 text-xs font-semibold text-ig-link hover:text-foreground";

// Right column of the home page on wide screens: account and suggestions.
// The suggestions block disappears when the API has no accounts to offer.
export function RightSidebar() {
  const currentUser = useHomeIdentity();
  const suggestions = useSuggestions();
  return (
    <aside className="hidden w-95.75 shrink-0 pt-6 pl-16 min-[1160px]:block">
      {currentUser && <div className="flex items-center gap-3">
        <Link href={`/${currentUser.username}`} aria-label="Ваш профиль">
          <DefaultAvatar size={44} />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link
            href={`/${currentUser.username}`}
            className="block truncate text-sm font-semibold"
          >
            {currentUser.username}
          </Link>
          <p className="truncate text-sm text-muted-foreground">
            {currentUser.email}
          </p>
        </div>
        <Link href="/accounts/edit" className={linkButtonClass}>Настройки</Link>
      </div>}

      {suggestions && (
        <section aria-labelledby="sidebar-suggestions-title">
          <h2
            id="sidebar-suggestions-title"
            className="mt-6 mb-2 text-sm font-semibold text-muted-foreground"
          >
            Рекомендации для вас
          </h2>
          <ul className="flex flex-col">
            {suggestions.items.slice(0, 5).map((user) => (
              <li key={user.id} className="flex items-center gap-3 py-2">
                <Link href={`/${user.username}`} aria-hidden tabIndex={-1}>
                  <Avatar name={user.username} size={44} />
                </Link>
                <div className="min-w-0 flex-1 leading-tight">
                  <Link
                    href={`/${user.username}`}
                    className="block truncate text-sm font-semibold"
                  >
                    {user.username}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.displayName || "Рекомендации для вас"}
                  </p>
                </div>
                <FollowButton
                  key={suggestions.follow[user.id] ?? "none"}
                  variant="link"
                  userId={user.id}
                  username={user.username}
                  initial={suggestions.follow[user.id] ?? "none"}
                  onChange={(state) => suggestions.setFollow(user.id, state)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 text-xs text-muted-foreground/70">
        <ul className="flex flex-wrap gap-x-1 leading-5">
          {footerLinks.map((label, index) => (
            <li key={label}>
              {label}
              {index < footerLinks.length - 1 && " ·"}
            </li>
          ))}
        </ul>
        <p className="mt-4 uppercase">© 2026 Instagram Clone</p>
      </footer>
    </aside>
  );
}
