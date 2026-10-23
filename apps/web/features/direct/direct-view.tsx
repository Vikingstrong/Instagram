"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DirectIcon } from "@/components/icons/ig-icons";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";
import { cn } from "@/lib/utils";

import { Inbox } from "./inbox";
import { Thread } from "./thread";
import { useDirectEvents } from "./use-direct-events";

// /direct and /direct/t/[id]. Wide screens show the list and the open
// conversation side by side; phones show one of them. The page keeps one
// SSE stream for the tab (stage 7).
export function DirectView() {
  const params = useParams<{ id?: string }>();
  const selectedId = params.id;
  const viewer = useHomeIdentity();
  const checking = useHomeChecking();
  const [version, setVersion] = useState(0);
  const [syncKey, setSyncKey] = useState(0);
  const [shown, setShown] = useState(viewer);
  // Keep the open chat during a brief session recheck (identity is null).
  if (viewer && viewer.id !== shown?.id) setShown(viewer);

  useEffect(() => {
    const refresh = () => {
      setVersion((value) => value + 1);
      setSyncKey((value) => value + 1);
    };
    window.addEventListener("instagram-call-history", refresh);
    return () => window.removeEventListener("instagram-call-history", refresh);
  }, []);

  const connection = useDirectEvents({
    enabled: Boolean(shown),
    // Any new message moves its conversation up the list; the open one
    // also reads the new messages.
    onNotice: (notice) => {
      setVersion((value) => value + 1);
      if (notice.conversationId === selectedId)
        setSyncKey((value) => value + 1);
    },
    onSync: () => {
      setVersion((value) => value + 1);
      setSyncKey((value) => value + 1);
    },
  });

  if (!shown || (!viewer && !checking))
    return (
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Войдите, чтобы читать сообщения.
        </p>
        <Link href="/auth/login" className="font-semibold text-ig-link">
          Войти
        </Link>
      </div>
    );

  return (
    <div className="flex h-[calc(100dvh-3rem-env(safe-area-inset-bottom))] min-h-0 md:h-dvh">
      <Inbox
        viewerId={shown.id}
        username={shown.username}
        selectedId={selectedId}
        version={version}
        className={cn(
          "w-full shrink-0 border-r md:w-90 lg:w-99",
          selectedId && "max-md:hidden",
        )}
      />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          !selectedId && "max-md:hidden",
        )}
      >
        {selectedId ? (
          <Thread
            key={selectedId}
            conversationId={selectedId}
            viewerId={shown.id}
            syncKey={syncKey}
            connection={connection}
            onActivity={() => setVersion((value) => value + 1)}
          />
        ) : (
          <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
            <span className="flex size-24 items-center justify-center rounded-full border-2 border-foreground">
              <DirectIcon className="size-12" />
            </span>
            <h2 className="text-xl">Ваши сообщения</h2>
            <p className="text-sm text-muted-foreground">
              Отправляйте личные сообщения друзьям. Откройте профиль и нажмите
              «Написать».
            </p>
            <Link
              href="/search"
              className="h-8 rounded-lg bg-ig-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-ig-blue-hover"
            >
              Найти человека
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
