import type { ComponentType } from "react";

import {
  CreateIcon,
  DirectIcon,
  HeartIcon,
  HomeIcon,
  ReelsIcon,
  SearchIcon,
  type IconProps,
} from "@/components/icons/ig-icons";

import { ProfileNavIcon } from "./profile-nav-icon";

export type NavItem = {
  id: "home" | "reels" | "direct" | "search" | "notifications" | "create" | "profile";
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
};

// Routes are placeholders until their roadmap slices add pages. The profile
// item points to the signed-in user's page (see navHref).
export const navItems: NavItem[] = [
  { id: "home", href: "/", label: "Главная", icon: HomeIcon },
  { id: "reels", href: "/reels", label: "Reels", icon: ReelsIcon },
  { id: "direct", href: "/direct", label: "Сообщения", icon: DirectIcon },
  { id: "search", href: "/search", label: "Поисковый запрос", icon: SearchIcon },
  { id: "notifications", href: "/notifications", label: "Уведомления", icon: HeartIcon },
  { id: "create", href: "/create", label: "Создать", icon: CreateIcon },
  { id: "profile", href: "/auth/session", label: "Профиль", icon: ProfileNavIcon },
];

export const mobileNavIds: NavItem["id"][] = [
  "home",
  "reels",
  "direct",
  "search",
  "profile",
];

// Guests and a session being rechecked have no profile page yet.
export function navHref(item: NavItem, username: string | undefined): string {
  return item.id === "profile" && username ? `/${username}` : item.href;
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
