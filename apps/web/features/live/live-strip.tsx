"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Live } from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { useHomeIdentity } from "@/features/auth/home-access";
import { createLivesClient } from "@/lib/api/lives";

import { useLiveNotices } from "./live-notices";
import { LiveBadge } from "./live-stage";

const REFRESH_MS = 30_000;

export const liveHref = (live: Live, viewerId?: string) =>
  live.host.id === viewerId ? "/live" : `/live/${live.id}`;

// Avatar with the live ring: a link into the stream.
export function LiveAvatar({
  live,
  viewerId,
  size,
  label,
}: {
  live: Live;
  viewerId?: string;
  size: number;
  label?: string;
}) {
  return (
    <Link
      href={liveHref(live, viewerId)}
      aria-label={label ?? `Смотреть эфир ${live.host.username}`}
      className="relative flex shrink-0 flex-col items-center"
    >
      <span className="rounded-full bg-linear-to-tr from-[#d300c5] via-[#ff0069] to-[#ff7a00] p-[2.5px]">
        <span className="block rounded-full bg-background p-[2px]">
          <Avatar name={live.host.username} src={live.host.avatarUrl} size={size} />
        </span>
      </span>
      <LiveBadge className="absolute -bottom-1.5 border-2 border-background px-1 text-[9px]" />
    </Link>
  );
}

// Streams of followed accounts (and one's own) at the top of the home feed.
// Refreshed by SSE notices — followers get one at start and end — and a
// slow timer; nothing is shown when nobody is on air.
export function LiveStrip() {
  const viewer = useHomeIdentity();
  const viewerId = viewer?.id;
  const [items, setItems] = useState<Live[]>([]);
  const loading = useRef(false);

  async function load(signal?: AbortSignal) {
    if (loading.current) return;
    loading.current = true;
    const result = await createLivesClient().list(signal);
    loading.current = false;
    if (result.ok) setItems(result.data.items);
  }
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    void loader.current(controller.signal);
    const timer = setInterval(() => void loader.current(), REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [viewerId]);
  useLiveNotices(() => {
    if (viewerId) void loader.current();
  });

  if (!viewerId || items.length === 0) return null;
  return (
    <section aria-label="Сейчас в эфире" className="flex gap-4 overflow-x-auto px-4 pt-1 pb-3 md:px-0">
      {items.map((live) => (
        <div key={live.id} className="flex w-18 shrink-0 flex-col items-center gap-2.5">
          <LiveAvatar live={live} viewerId={viewerId} size={56} />
          <span className="w-full truncate text-center text-xs">
            {live.host.id === viewerId ? "Ваш эфир" : live.host.username}
          </span>
        </div>
      ))}
    </section>
  );
}

// The profile owner's stream on air, or null.
export function useHostLive(userId: string, enabled: boolean) {
  const [live, setLive] = useState<Live | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void createLivesClient()
      .byHost(userId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && result.ok) setLive(result.data.live);
      });
    return () => controller.abort();
  }, [userId, enabled, revision]);
  useLiveNotices(() => setRevision((value) => value + 1));
  return enabled ? live : null;
}
