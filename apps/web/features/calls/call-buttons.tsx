"use client";
import { Phone, Video } from "lucide-react";
import type { Conversation } from "@instagram/contracts";
import { useCalls } from "./calls-provider";
export function CallButtons({ conversation }: { conversation: Conversation }) {
  const calls = useCalls();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label="Аудиозвонок"
        disabled={!calls || calls.busy}
        onClick={() => calls?.start(conversation, "AUDIO")}
        className="rounded-full p-2.5 text-foreground transition hover:bg-secondary disabled:opacity-40"
      >
        <Phone size={21} />
      </button>
      <button
        type="button"
        aria-label="Видеозвонок"
        disabled={!calls || calls.busy}
        onClick={() => calls?.start(conversation, "VIDEO")}
        className="rounded-full p-2.5 text-foreground transition hover:bg-secondary disabled:opacity-40"
      >
        <Video size={23} />
      </button>
    </div>
  );
}
