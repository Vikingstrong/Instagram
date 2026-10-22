"use client";

import { useRef, useState } from "react";
import type { FollowResponse } from "@instagram/contracts";

import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";
import { cn } from "@/lib/utils";

export type FollowState = FollowResponse["relationship"];

const labels: Record<FollowState, string> = {
  none: "Подписаться",
  requested: "Запрос отправлен",
  following: "Вы подписаны",
};

const variants = {
  // Profile header and suggestion cards.
  button: {
    base: "h-8 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60",
    none: "bg-ig-blue text-white hover:bg-ig-blue-hover",
    active: "bg-secondary text-foreground hover:bg-secondary/80",
  },
  // Compact text action in the right sidebar and lists.
  link: {
    base: "shrink-0 text-xs font-semibold disabled:opacity-60",
    none: "text-ig-link hover:text-foreground",
    active: "text-muted-foreground hover:text-foreground",
  },
};

// Follow / Requested / Following. A second click unfollows or cancels the
// request. The server answer is the source of truth; no optimistic state.
export function FollowButton({
  userId,
  username,
  initial,
  variant = "button",
  className,
  onChange,
}: {
  userId: string;
  username: string;
  initial: FollowState;
  variant?: keyof typeof variants;
  className?: string;
  onChange?: (state: FollowState) => void;
}) {
  const [state, setState] = useState<FollowState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const style = variants[variant];

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const client = createSocialClient();
    const result =
      state === "none"
        ? await client.follow(userId)
        : await client.unfollow(userId);
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setState(result.data.relationship);
    onChange?.(result.data.relationship);
  }

  return (
    <span className="inline-flex flex-col items-stretch">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={`${labels[state]}: ${username}`}
        className={cn(
          style.base,
          state === "none" ? style.none : style.active,
          className,
        )}
      >
        {busy ? "…" : labels[state]}
      </button>
      {error && (
        <span role="alert" className="mt-1 max-w-48 text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
