import type { ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { MessagesFab } from "./messages-fab";
import { MobileHeader } from "./mobile-header";
import { SidebarNav } from "./sidebar-nav";

// Responsive frame for signed-in pages. Pages own their inner layout; the
// expanded rail overlays content instead of pushing it.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-60 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Перейти к содержимому
      </a>

      <MobileHeader />
      <SidebarNav />

      <main
        id="main-content"
        className="flex flex-1 flex-col pb-[calc(3rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-18"
      >
        {children}
      </main>

      <MessagesFab />
      <BottomNav />
    </div>
  );
}
