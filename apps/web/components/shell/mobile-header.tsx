import Link from "next/link";

import { HeartIcon } from "@/components/icons/ig-icons";
import { CreateMenu } from "./create-menu";

// Mobile top bar; desktop shows the logo inside SidebarNav instead.
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
      <Link href="/" className="font-wordmark text-[28px] leading-none">
        Instagram
      </Link>
      <div className="flex items-center gap-5">
        <CreateMenu className="grid size-10 place-items-center rounded-full transition-colors hover:bg-secondary active:opacity-60" />
        <Link
          href="/notifications"
          aria-label="Уведомления"
          className="active:opacity-60"
        >
          <HeartIcon />
        </Link>
      </div>
    </header>
  );
}
