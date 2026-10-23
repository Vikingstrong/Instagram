"use client";

import { useRef, useState } from "react";

import { HeartIcon } from "@/components/icons/ig-icons";
import { plural } from "@/features/social/profile-view";
import { describeFailure } from "@/lib/api/messages";
import { createPostsClient } from "@/lib/api/posts";
import { cn } from "@/lib/utils";

export type LikeState = { liked: boolean; likeCount: number };

// Optimistic like: the heart and counter change at once, the server's answer
// replaces them, and a failure restores the previous state with a message.
// One request at a time, so quick double taps cannot reorder answers.
export function useLike(postId: string, initial: LikeState) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    const previous = state;
    const liked = !previous.liked;
    setError(undefined);
    setState({
      liked,
      likeCount: Math.max(0, previous.likeCount + (liked ? 1 : -1)),
    });
    const client = createPostsClient();
    const result = await (liked ? client.like(postId) : client.unlike(postId));
    pending.current = false;
    if (result.ok) {
      setState(result.data);
      return;
    }
    setState(previous);
    setError(describeFailure(result.failure));
  }

  return { ...state, error, toggle };
}

export function LikeButton({
  liked,
  onToggle,
}: {
  liked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={liked ? "Не нравится" : "Нравится"}
      aria-pressed={liked}
      onClick={onToggle}
      className={cn(
        "transition-[opacity,transform] hover:opacity-60 active:scale-90",
        liked && "text-[#ff3040] hover:opacity-100",
      )}
    >
      <HeartIcon active={liked} />
    </button>
  );
}

export const likesLabel = (count: number) =>
  plural(count, ["отметка «Нравится»", "отметки «Нравится»", "отметок «Нравится»"]);
