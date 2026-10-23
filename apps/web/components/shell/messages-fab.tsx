"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { DirectIcon } from "@/components/icons/ig-icons";

// Floating shortcut to Direct on wide screens, as in the desktop app.
// Hidden inside Direct itself, where it would cover the composer.
export function MessagesFab() {
  const pathname = usePathname();
  if (pathname === "/direct" || pathname.startsWith("/direct/")) return null;
  return (
    <Link
      href="/direct"
      className="fixed right-6 bottom-8 z-40 hidden h-14 w-62.5 items-center gap-3 rounded-full border bg-ig-elevated px-5 text-base font-semibold shadow-[0_4px_16px_rgb(0_0_0/0.4)] transition-colors hover:bg-secondary lg:flex"
    >
      <DirectIcon />
      Сообщения
    </Link>
  );
}
