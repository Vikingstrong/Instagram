import Link from "next/link";

import { VerifiedBadge } from "@/components/icons/ig-icons";
import { Avatar, DefaultAvatar } from "@/components/ui-ig/avatar";

import type { MockUser } from "./mock-data";

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
export function RightSidebar({
  currentUser,
  suggestions,
}: {
  currentUser: MockUser;
  suggestions: MockUser[];
}) {
  return (
    <aside className="hidden w-95.75 shrink-0 pt-6 pl-16 min-[1160px]:block">
      <div className="flex items-center gap-3">
        <DefaultAvatar size={44} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{currentUser.username}</p>
          <p className="truncate text-sm text-muted-foreground">
            {currentUser.displayName}
          </p>
        </div>
        <button type="button" className={linkButtonClass}>
          Переключиться
        </button>
      </div>

      <div className="mt-6 mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Рекомендации для вас
        </h2>
        <Link
          href="/explore/people"
          className="text-xs font-semibold hover:text-muted-foreground"
        >
          Все
        </Link>
      </div>

      <ul className="flex flex-col">
        {suggestions.map((user) => (
          <li key={user.username} className="flex items-center gap-3 py-2">
            <Avatar name={user.username} size={44} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="flex items-center gap-1 text-sm font-semibold">
                <Link href={`/${user.username}`} className="truncate">
                  {user.username}
                </Link>
                {user.verified && <VerifiedBadge />}
              </p>
              <p className="truncate text-xs text-muted-foreground">Популярное</p>
            </div>
            <button type="button" className={linkButtonClass}>
              Подписаться
            </button>
          </li>
        ))}
      </ul>

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
