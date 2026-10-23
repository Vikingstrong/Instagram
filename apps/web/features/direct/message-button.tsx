"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { createDirectClient } from "@/lib/api/direct";
import { describeFailure } from "@/lib/api/messages";

// Profile action: opens (or creates) the conversation and goes to it. Works
// for any verified user, including private accounts (FR-09).
export function MessageButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  async function open() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    const result = await createDirectClient().open(userId);
    pending.current = false;
    setBusy(false);
    if (result.ok) router.push(`/direct/t/${result.data.conversation.id}`);
    else setError(describeFailure(result.failure));
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="inline-flex h-8 items-center rounded-lg bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80 disabled:opacity-60"
      >
        Написать
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
