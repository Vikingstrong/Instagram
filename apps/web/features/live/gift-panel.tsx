"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Gift, X } from "lucide-react";
import type { LiveGift, LiveGiftKey } from "@instagram/contracts";

import { openModal } from "@/components/ui-ig/confirm-dialog";
import { createCoinsClient } from "@/lib/api/coins";
import { createLivesClient } from "@/lib/api/lives";
import { describeFailure } from "@/lib/api/messages";
import { cn } from "@/lib/utils";

import { GiftPicture } from "./gift-effects";
import { closeModal } from "./moderation";
import { coins, gifts } from "./gifts";
import { roundButton } from "./live-stage";

// FR-14: the gift icon in a stream opens the gifts. A tap sends one; the
// price leaves the wallet and goes to the host. The balance shown is the
// server's answer, never a local subtraction.
export function GiftPanel({
  liveId,
  onSent,
}: {
  liveId: string;
  onSent: (gift: LiveGift) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [balance, setBalance] = useState<string>();
  const [sending, setSending] = useState<LiveGiftKey>();
  const [status, setStatus] = useState<{ text: string; poor?: boolean; error?: boolean }>();
  // One intent per gift until it succeeds: a retry reuses its id.
  const intents = useRef(new Map<LiveGiftKey, string>());

  async function open() {
    setStatus(undefined);
    openModal(dialog.current);
    const wallet = await createCoinsClient().wallet();
    if (wallet.ok) setBalance(wallet.data.wallet.balance);
  }

  async function send(key: LiveGiftKey) {
    if (sending) return;
    let id = intents.current.get(key);
    if (!id) intents.current.set(key, (id = crypto.randomUUID()));
    setSending(key);
    setStatus(undefined);
    const result = await createLivesClient().sendGift(liveId, { id, giftKey: key });
    setSending(undefined);
    if (!result.ok) {
      const failure = result.failure;
      const code = failure.kind === "api" ? failure.error.code : undefined;
      // A refused gift is not paid: the next tap is a new intent.
      if (failure.kind === "api") intents.current.delete(key);
      setStatus({
        text: describeFailure(failure),
        poor: code === "COINS_INSUFFICIENT_BALANCE",
        error: true,
      });
      return;
    }
    intents.current.delete(key);
    setBalance(result.data.balance);
    const gift = gifts.find((item) => item.key === key)!;
    setStatus({ text: `Отправлено: «${gift.name}»` });
    // The full-screen show must not stay under this modal.
    if (gift.fullscreen) closeModal(dialog.current);
    onSent(result.data.gift);
  }

  return (
    <>
      <button type="button" onClick={() => void open()} aria-label="Подарки" className={roundButton}>
        <Gift size={20} />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="gifts-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeModal(dialog.current);
        }}
        className="fixed inset-x-0 bottom-0 m-0 mt-auto w-full max-w-none rounded-t-3xl border bg-ig-elevated p-0 text-foreground backdrop:bg-black/50 md:inset-0 md:m-auto md:max-w-md md:rounded-3xl"
      >
        <div className="flex flex-col gap-4 p-5">
          <header className="flex items-center justify-between">
            <h2 id="gifts-title" className="text-lg font-semibold">
              Подарки
            </h2>
            <button
              type="button"
              aria-label="Закрыть подарки"
              onClick={() => closeModal(dialog.current)}
              className="rounded-full p-1.5 hover:bg-secondary"
            >
              <X size={20} />
            </button>
          </header>
          <p className="text-sm text-muted-foreground">
            Монеты за подарок получит автор эфира.{" "}
            <span className="font-semibold text-foreground" aria-live="polite">
              Баланс: {balance === undefined ? "…" : coins(balance)}
            </span>
          </p>
          <ul className="grid grid-cols-3 gap-3">
            {gifts.map((gift) => (
              <li key={gift.key}>
                <button
                  type="button"
                  onClick={() => void send(gift.key)}
                  disabled={sending !== undefined}
                  aria-label={`Подарить «${gift.name}» за ${coins(gift.price, true)}`}
                  className={cn(
                    "flex w-full flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-colors hover:bg-secondary disabled:opacity-60",
                    gift.fullscreen && "border-[#ff0069]/40",
                    sending === gift.key && "animate-pulse",
                  )}
                >
                  <GiftPicture gift={gift} size={56} />
                  <span className="line-clamp-2 min-h-8 text-xs leading-4">{gift.name}</span>
                  <span className="text-xs font-semibold text-amber-400">{coins(gift.price)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Подарки дороже 10 монет показываются на весь экран всем зрителям.
          </p>
          {status && (
            <p
              role={status.error ? "alert" : "status"}
              className={cn("text-sm", status.error ? "text-destructive" : "text-emerald-400")}
            >
              {status.text}{" "}
              {status.poor && (
                <Link href="/coins" target="_blank" className="font-semibold text-ig-link">
                  Получить монеты
                </Link>
              )}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
