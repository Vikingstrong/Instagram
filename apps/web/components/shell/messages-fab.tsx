import Link from "next/link";

import { DirectIcon } from "@/components/icons/ig-icons";

// Floating shortcut to Direct on wide screens, as in the desktop app.
export function MessagesFab() {
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
