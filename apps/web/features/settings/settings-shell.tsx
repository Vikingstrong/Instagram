"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";

import {
  LockIcon,
  LogoutIcon,
  SettingsIcon,
  UserIcon,
  type IconProps,
} from "@/components/icons/ig-icons";
import { useHomeIdentity } from "@/features/auth/home-access";
import { LogoutDialog } from "@/features/auth/logout-dialog";
import { cn } from "@/lib/utils";

const sections: {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
}[] = [
  { href: "/accounts/edit", label: "Редактировать профиль", icon: UserIcon },
  { href: "/accounts/privacy", label: "Конфиденциальность", icon: LockIcon },
  { href: "/accounts/account", label: "Аккаунт", icon: SettingsIcon },
];

// Settings frame: a section list (column on desktop, tabs on mobile) and the
// sign-out entry, which always asks for confirmation first.
export function SettingsShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const username = useHomeIdentity()?.username;
  const [logout, setLogout] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-233.75 flex-col md:flex-row">
      <nav
        aria-label="Настройки"
        className="shrink-0 border-b px-4 pt-6 md:min-h-dvh md:w-79 md:border-r md:border-b-0 md:px-6 md:pt-10"
      >
        <h2 className="mb-4 hidden px-3 text-xl font-bold md:block">Настройки</h2>
        <ul className="scrollbar-none flex gap-1 overflow-x-auto pb-3 md:flex-col md:pb-0">
          {sections.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap transition-colors hover:bg-secondary md:py-3.5",
                    active && "bg-secondary font-semibold",
                  )}
                >
                  <Icon className="size-5 md:size-6" />
                  {label}
                </Link>
              </li>
            );
          })}
          <li className="shrink-0 md:mt-4 md:border-t md:pt-4">
            <button
              type="button"
              onClick={() => setLogout(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap text-destructive transition-colors hover:bg-secondary md:py-3.5"
            >
              <LogoutIcon className="size-5 md:size-6" />
              Выйти
            </button>
          </li>
        </ul>
      </nav>
      <section className="flex min-w-0 flex-1 flex-col gap-8 px-4 py-8 md:px-14 md:py-10">
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
      </section>
      {logout && (
        <LogoutDialog username={username} onClose={() => setLogout(false)} />
      )}
    </div>
  );
}

// Shared look of settings inputs.
export const settingsField =
  "w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none transition-colors focus:border-foreground disabled:text-muted-foreground";
export const settingsPrimaryButton =
  "h-11 rounded-lg bg-ig-blue px-8 text-sm font-semibold text-white transition-colors hover:bg-ig-blue-hover disabled:opacity-50";
