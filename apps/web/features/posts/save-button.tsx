"use client";

import { useRef, useState } from "react";

import { BookmarkIcon } from "@/components/icons/ig-icons";
import { createPostsClient } from "@/lib/api/posts";

// Bookmark into the viewer's private "Сохранённое". Optimistic like the
// heart: the icon flips at once and rolls back if the server refuses.
export function SaveButton({
  postId,
  initial = false,
  className,
}: {
  postId: string;
  initial?: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initial);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    const next = !saved;
    setSaved(next);
    setFailed(false);
    const client = createPostsClient();
    const result = await (next ? client.save(postId) : client.unsave(postId));
    pending.current = false;
    if (result.ok) setSaved(result.data.saved);
    else {
      setSaved(!next);
      setFailed(true);
    }
  }

  return (
    <button
      type="button"
      aria-label={saved ? "Удалить из сохранённого" : "Сохранить"}
      aria-pressed={saved}
      title={failed ? "Не удалось сохранить. Попробуйте ещё раз." : undefined}
      onClick={toggle}
      className={`transition-[opacity,transform] hover:opacity-60 active:scale-90 ${className ?? ""}`}
    >
      <BookmarkIcon active={saved} />
    </button>
  );
}
