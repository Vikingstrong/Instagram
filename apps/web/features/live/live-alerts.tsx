"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  authEndpoints,
  AuthSessionResponseSchema,
  type Live,
} from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { createApiClient } from "@/lib/api/client";
import { createLivesClient } from "@/lib/api/lives";

import { useLiveNotices } from "./live-notices";

const SHOW_MS = 8000;

// "<user> started a live video": followers get an SSE notice when a stream
// starts. Each stream is announced once per tab, never on the live pages and
// never to its own host.
export function LiveAlerts() {
  const pathname = usePathname();
  const [alert, setAlert] = useState<Live>();
  const seen = useRef(new Set<string>());
  const onLivePage = pathname === "/live" || pathname.startsWith("/live/");

  useLiveNotices((liveId) => {
    if (onLivePage || seen.current.has(liveId)) return;
    seen.current.add(liveId);
    // The session is read each time: the account may have changed.
    const self = createApiClient()
      .request(authEndpoints.session, AuthSessionResponseSchema)
      .then((result) => (result.ok ? result.data.user?.id : undefined));
    void Promise.all([self, createLivesClient().get(liveId)]).then(
      ([viewerId, result]) => {
        if (
          result.ok &&
          result.data.live.status === "LIVE" &&
          result.data.live.host.id !== viewerId
        )
          setAlert(result.data.live);
      },
    );
  });
  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(undefined), SHOW_MS);
    return () => clearTimeout(timer);
  }, [alert]);

  if (!alert || onLivePage) return null;
  return (
    <div
      role="status"
      className="fixed top-16 left-1/2 z-[95] flex w-[min(92vw,380px)] -translate-x-1/2 items-center gap-3 rounded-2xl border bg-ig-elevated p-3 shadow-xl md:top-6"
    >
      <Avatar name={alert.host.username} src={alert.host.avatarUrl} size={36} />
      <p className="min-w-0 flex-1 text-sm">
        <b>{alert.host.username}</b> начал(а) прямой эфир
      </p>
      <Link
        href={`/live/${alert.id}`}
        onClick={() => setAlert(undefined)}
        className="rounded-lg bg-ig-blue px-3 py-1.5 text-sm font-semibold text-white"
      >
        Смотреть
      </Link>
      <button
        type="button"
        aria-label="Закрыть уведомление об эфире"
        onClick={() => setAlert(undefined)}
        className="px-1 text-lg text-muted-foreground"
      >
        ×
      </button>
    </div>
  );
}
