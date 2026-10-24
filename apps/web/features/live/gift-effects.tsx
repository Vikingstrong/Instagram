"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { LiveGift } from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { createLivesClient } from "@/lib/api/lives";
import { cn } from "@/lib/utils";

import { coins, giftInfo } from "./gifts";
import { useLiveNotices } from "./live-notices";

const POLL_MS = 2000;
const PILL_MS = 4500;
const FULLSCREEN_MS = 3800;

// New gifts of the stream, in order. Gifts sent before the page opened are
// history and play nothing; the sender's own gift arrives through `own`
// at once and again from the API, so ids are deduplicated.
export function useGiftFeed(
  liveId: string,
  open: boolean,
  onGift: (gift: LiveGift) => void,
) {
  const cursor = useRef<string | null | undefined>(undefined);
  const busy = useRef(false);
  const handler = useRef(onGift);
  useEffect(() => {
    handler.current = onGift;
  });
  const load = useRef(async () => {});
  useEffect(() => {
    load.current = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const first = cursor.current === undefined;
        const result = await createLivesClient().gifts(liveId, cursor.current ?? undefined);
        if (!result.ok) return;
        cursor.current = result.data.next;
        if (!first) for (const gift of result.data.items) handler.current(gift);
      } finally {
        busy.current = false;
      }
    };
  }, [liveId]);
  useEffect(() => {
    if (!open) return;
    void load.current();
    const timer = setInterval(() => void load.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, liveId]);
  useLiveNotices((id) => {
    if (open && id === liveId) void load.current();
  });
}

// FR-14 display: a small "sent" line for every gift, and gifts above 10
// coins full screen for everyone watching, one after another.
export function GiftEffects({
  liveId,
  open,
  own,
}: {
  liveId: string;
  open: boolean;
  // A gift this viewer has just sent.
  own?: LiveGift;
}) {
  const [pills, setPills] = useState<LiveGift[]>([]);
  const [queue, setQueue] = useState<LiveGift[]>([]);
  const seen = useRef(new Set<string>());

  function show(gift: LiveGift) {
    if (seen.current.has(gift.id)) return;
    seen.current.add(gift.id);
    setPills((current) => [...current, gift].slice(-3));
    setTimeout(
      () => setPills((current) => current.filter((item) => item.id !== gift.id)),
      PILL_MS,
    );
    if (giftInfo(gift.giftKey).fullscreen) setQueue((current) => [...current, gift]);
  }
  const shower = useRef(show);
  useEffect(() => {
    shower.current = show;
  });
  useGiftFeed(liveId, open, (gift) => shower.current(gift));
  useEffect(() => {
    if (own) shower.current(own);
  }, [own]);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setQueue((items) => items.slice(1)), FULLSCREEN_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return (
    <>
      <ol
        aria-label="Подарки в эфире"
        className="pointer-events-none absolute bottom-20 left-3 z-20 flex max-w-[80%] flex-col gap-2"
      >
        {pills.map((gift) => {
          const info = giftInfo(gift.giftKey);
          return (
            <li
              key={gift.id}
              className="flex animate-in items-center gap-2 rounded-full bg-black/55 py-1 pr-3 pl-1 text-xs text-white backdrop-blur-md fade-in slide-in-from-left-4"
            >
              <Avatar name={gift.sender.username} src={gift.sender.avatarUrl} size={24} />
              <span className="min-w-0 truncate">
                <b>{gift.sender.username}</b> отправил(а) «{info.name}»
              </span>
              <GiftPicture gift={info} size={26} />
            </li>
          );
        })}
      </ol>
      {current && <Celebration key={current.id} gift={current} />}
    </>
  );
}

function Celebration({ gift }: { gift: LiveGift }) {
  const info = giftInfo(gift.giftKey);
  return (
    <div
      role="status"
      aria-label={`${gift.sender.username} дарит «${info.name}» за ${coins(gift.price, true)}`}
      className="pointer-events-none fixed inset-0 z-[120] flex animate-in flex-col items-center justify-center gap-6 bg-[radial-gradient(circle,rgba(255,0,105,0.35)_0%,rgba(10,10,20,0.85)_70%)] fade-in"
    >
      <div className="animate-in duration-700 zoom-in-50 spin-in-6">
        <GiftPicture
          gift={info}
          size={320}
          fluid
          className="size-[min(70vw,46dvh)] animate-bounce drop-shadow-[0_20px_60px_rgba(255,0,105,0.6)]"
        />
      </div>
      <p className="flex animate-in items-center gap-3 rounded-2xl bg-black/50 px-5 py-3 text-center text-lg text-white backdrop-blur-md slide-in-from-bottom-6 md:text-xl">
        <Avatar name={gift.sender.username} src={gift.sender.avatarUrl} size={36} />
        <span>
          <b>{gift.sender.username}</b> дарит «{info.name}»
          <span className="block text-sm text-white/75">{coins(gift.price)}</span>
        </span>
      </p>
    </div>
  );
}

export function GiftPicture({
  gift,
  size,
  fluid,
  className,
}: {
  gift: ReturnType<typeof giftInfo>;
  size: number;
  // Sized by className instead of size.
  fluid?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={gift.image}
      alt=""
      width={size}
      height={size}
      // Static public art; a GIF keeps its animation only unoptimized.
      unoptimized
      draggable={false}
      style={fluid ? undefined : { width: size, height: size }}
      className={cn("shrink-0 object-contain", gift.pixelated && "[image-rendering:pixelated]", className)}
    />
  );
}
