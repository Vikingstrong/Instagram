"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  AppsIcon,
  InstagramGlyphIcon,
  MenuIcon,
} from "@/components/icons/ig-icons";
import { cn } from "@/lib/utils";

import { useHomeIdentity } from "@/features/auth/home-access";

import { isNavItemActive, navHref, navItems } from "./nav-items";

const rowClass =
  "flex h-12 w-full items-center gap-4 rounded-lg px-3 transition-colors hover:bg-secondary active:opacity-60";

// Labels are always in the DOM (screen readers read them) and only fade in
// while the rail is expanded.
function RowLabel({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap text-base opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100",
        bold && "font-bold",
      )}
    >
      {children}
    </span>
  );
}

// Desktop rail: 72px of icons, expands over the content on hover or focus.
export function SidebarNav() {
  const pathname = usePathname();
  const username = useHomeIdentity()?.username;

  return (
    <aside className="group/rail fixed inset-y-0 left-0 z-50 hidden w-18 flex-col overflow-hidden border-r bg-background px-3 pt-6 pb-5 transition-[width,box-shadow] duration-200 ease-out hover:w-61 hover:shadow-[4px_0_24px_rgb(0_0_0/0.45)] focus-within:w-61 md:flex">
      <Link
        href="/"
        aria-label="Instagram — главная"
        className="relative flex h-12 items-center rounded-lg px-3 hover:bg-secondary"
      >
        <InstagramGlyphIcon className="transition-opacity duration-200 group-hover/rail:opacity-0 group-focus-within/rail:opacity-0" />
        <span className="font-wordmark absolute left-3 text-[28px] leading-none whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100">
          Instagram
        </span>
      </Link>

      <nav aria-label="Основная навигация" className="flex flex-1 items-center">
        <ul className="flex w-full flex-col gap-2">
          {navItems.map((item) => {
            const { id, label, icon: Icon } = item;
            const href = navHref(item, username);
            const active = isNavItemActive(pathname, href);
            return (
              <li key={id}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={rowClass}
                >
                  <Icon active={active} />
                  <RowLabel bold={active}>{label}</RowLabel>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Design only: menus behind these buttons are not part of the MVP yet. */}
      <div className="flex flex-col gap-2">
        <button type="button" className={rowClass}>
          <MenuIcon />
          <RowLabel>Ещё</RowLabel>
        </button>
        <button type="button" className={rowClass}>
          <AppsIcon />
          <RowLabel>Также от Meta</RowLabel>
        </button>
      </div>
    </aside>
  );
}
