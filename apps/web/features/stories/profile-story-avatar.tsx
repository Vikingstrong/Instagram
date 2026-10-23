"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DefaultAvatar } from "@/components/ui-ig/avatar";
import { createStoriesClient } from "@/lib/api/stories";
export function ProfileStoryAvatar({
  userId,
  username,
  src,
  size,
  className,
}: {
  userId: string;
  username: string;
  src?: string | null;
  size: number;
  className?: string;
}) {
  const [hasStory, setHasStory] = useState(false);
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      let cursor: string | undefined;
      let active = false,
        unseen = false;
      do {
        const result = await createStoriesClient().byUser(
          userId,
          cursor,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!result.ok) {
          active = false;
          unseen = false;
          break;
        }
        active ||= result.data.items.some((s) => s.status === "ready");
        unseen ||= result.data.items.some(
          (s) => s.status === "ready" && !s.viewed,
        );
        cursor = result.data.nextCursor ?? undefined;
      } while (cursor && !unseen);
      setHasStory(active);
      setUnseen(unseen);
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [userId]);
  const face = <DefaultAvatar size={size} src={src} />;
  return hasStory ? (
    <Link
      href={`/stories/user/${userId}`}
      aria-label={`Истории ${username}`}
      className={`${className ?? ""} shrink-0 self-start rounded-full p-1 ${unseen ? "bg-linear-to-tr from-amber-400 via-rose-500 to-fuchsia-700" : "bg-muted-foreground/40"}`}
    >
      <span className="flex rounded-full bg-background p-1">{face}</span>
    </Link>
  ) : (
    <span className={className}>{face}</span>
  );
}
