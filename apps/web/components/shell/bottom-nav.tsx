"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useHomeIdentity } from "@/features/auth/home-access";

import { isNavItemActive, navHref, mobileNavIds, navItems } from "./nav-items";

const mobileItems = navItems.filter((item) => mobileNavIds.includes(item.id));

// Mobile navigation: fixed tab bar below md, respects the iOS home indicator.
export function BottomNav() {
  const pathname = usePathname();
  const username = useHomeIdentity()?.username;

  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex h-12 items-stretch justify-around">
        {mobileItems.map((item) => {
          const { id, label, icon: Icon } = item;
          const href = navHref(item, username);
          const active = isNavItemActive(pathname, href);
          return (
            <li key={id} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex flex-1 items-center justify-center active:opacity-60"
              >
                <Icon active={active} />
                <span className="sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
