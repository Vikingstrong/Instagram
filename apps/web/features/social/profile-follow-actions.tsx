"use client";

import { useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/icons/ig-icons";
import { Avatar } from "@/components/ui-ig/avatar";
import { ConfirmDialog } from "@/components/ui-ig/confirm-dialog";
import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";
import { cn } from "@/lib/utils";

import type { FollowState } from "./follow-button";

const base =
  "inline-flex h-8 min-w-30 items-center justify-center gap-1.5 rounded-lg px-5 text-sm font-semibold transition-colors disabled:opacity-60";
const primary = "bg-ig-blue text-white hover:bg-ig-blue-hover";
const secondary = "bg-secondary text-foreground hover:bg-secondary/75";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

// Profile header actions. Following starts at once; unfollowing or cancelling
// a request asks first, as losing access to a private profile needs a new
// request. Only the server's answer changes the state.
export function ProfileFollowActions({
  userId,
  username,
  isPrivate,
  relationship,
  onChange,
}: {
  userId: string;
  username: string;
  isPrivate: boolean;
  relationship: FollowState;
  onChange: (state: FollowState) => void;
}) {
  const [state, setState] = useState(relationship);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  async function run(action: "follow" | "unfollow") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const client = createSocialClient();
    const result =
      action === "follow" ? await client.follow(userId) : await client.unfollow(userId);
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setConfirm(false);
    setState(result.data.relationship);
    onChange(result.data.relationship);
  }

  return (
    <div className="flex flex-col gap-1">
      {state === "none" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run("follow")}
          className={cn(base, primary)}
        >
          {busy ? <Spinner /> : "Подписаться"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            setConfirm(true);
          }}
          aria-haspopup="dialog"
          className={cn(base, secondary)}
        >
          {state === "following" ? "Подписки" : "Запрос отправлен"}
          {state === "following" && <ChevronDownIcon className="size-4" strokeWidth={2.5} />}
        </button>
      )}
      {error && !confirm && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          media={<Avatar name={username} size={90} />}
          title={
            state === "following"
              ? `Отменить подписку на @${username}?`
              : "Отменить запрос на подписку?"
          }
          description={
            state === "following"
              ? isPrivate
                ? "Это закрытый аккаунт: чтобы снова видеть публикации, нужно будет отправить запрос."
                : undefined
              : `@${username} ещё не ответил на ваш запрос.`
          }
          confirmLabel={state === "following" ? "Отменить подписку" : "Отменить запрос"}
          busy={busy}
          error={error}
          onConfirm={() => void run("unfollow")}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
