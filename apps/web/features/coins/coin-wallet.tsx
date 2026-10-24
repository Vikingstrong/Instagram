"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  coinRules,
  type CoinTransaction,
  type CoinWallet,
} from "@instagram/contracts";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";
import { createCoinsClient, formatCoins } from "@/lib/api/coins";
import { describeFailure } from "@/lib/api/messages";

const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: coinRules.timeZone,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

export function CoinWalletView() {
  const user = useHomeIdentity();
  const checking = useHomeChecking();
  const userId = user?.id;
  const [snapshot, setSnapshot] = useState<{
    userId: string;
    wallet: CoinWallet;
  }>();
  const wallet = snapshot?.userId === userId ? snapshot?.wallet : undefined;
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const pending = useRef(false);
  const claimRequest = useRef<AbortController | undefined>(undefined);
  const walletRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!userId || checking || pending.current) return;
    const controller = new AbortController();
    walletRequest.current = controller;
    void createCoinsClient()
      .wallet(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setError(describeFailure(result.failure));
          return;
        }
        setSnapshot({ userId: userId!, wallet: result.data.wallet });
        setError(undefined);
      });
    return () => {
      controller.abort();
    };
  }, [userId, checking, revision]);
  useEffect(() => {
    if (!wallet || checking) return;
    // Every authoritative snapshot, including a claim response, schedules the
    // next midnight recheck using server time rather than the device clock.
    const refresh = setTimeout(
      () => setRevision((value) => value + 1),
      Math.max(
        1000,
        new Date(wallet.dailyReward.nextClaimAt).getTime() -
          new Date(wallet.serverTime).getTime() +
          100,
      ),
    );
    return () => clearTimeout(refresh);
  }, [wallet, checking]);
  useEffect(
    () => () => {
      claimRequest.current?.abort();
    },
    [userId, checking],
  );
  useEffect(() => {
    if (!userId || checking) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !pending.current) {
        setRevision((value) => value + 1);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [userId, checking]);

  async function claim() {
    if (pending.current || !wallet || wallet.dailyReward.claimed) return;
    pending.current = true;
    walletRequest.current?.abort();
    setBusy(true);
    setNotice("");
    setError(undefined);
    const controller = new AbortController();
    claimRequest.current = controller;
    const result = await createCoinsClient().claim(controller.signal);
    pending.current = false;
    if (controller.signal.aborted) {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    setSnapshot({ userId: userId!, wallet: result.data.wallet });
    setNotice(
      result.data.credited
        ? "Начислено 100 монет."
        : "Сегодняшний бонус уже получен.",
    );
    setHistoryRevision((value) => value + 1);
  }

  if (checking)
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        Проверяем сессию…
      </p>
    );
  if (!user)
    return (
      <section className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Монеты</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Войдите, чтобы открыть свой кошелёк и получать ежедневный бонус.
        </p>
        <Link
          href="/auth/login"
          className="mt-5 inline-block text-sm font-semibold text-ig-link"
        >
          Войти
        </Link>
      </section>
    );
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6 md:py-12">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Монеты</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Ваш баланс и ежедневный бонус.
        </p>
      </header>
      {!wallet && !error ? (
        <p role="status" className="py-12 text-sm text-muted-foreground">
          Загружаем баланс…
        </p>
      ) : (
        wallet && (
          <section
            aria-label="Кошелёк"
            className="grid overflow-hidden rounded-2xl border md:grid-cols-[1.15fr_1fr]"
          >
            <div className="relative flex min-h-60 items-center justify-between gap-2 bg-[#101114] p-6 text-[#f5f5f5] sm:p-8">
              <div className="relative z-10 min-w-0 flex-1">
                <p className="text-sm text-[#a8a8a8]">Ваш баланс</p>
                <p
                  aria-label={`${wallet.balance} монет`}
                  className="mt-4 wrap-anywhere text-4xl font-medium tracking-tight tabular-nums sm:text-5xl"
                >
                  {formatCoins(wallet.balance)}
                </p>
                <p className="mt-2 text-sm text-[#c3a570]">золотых коинов</p>
                <p className="mt-6 text-xs text-[#a8a8a8]">
                  Монеты сохраняются на аккаунте.
                </p>
              </div>
              <Image
                src="/coins/instagram-coins.png"
                width={180}
                height={120}
                sizes="(max-width: 640px) 120px, 160px"
                alt=""
                aria-hidden
                className="w-28 shrink-0 object-contain sm:w-40"
              />
            </div>
            <div className="flex flex-col justify-between gap-6 border-t p-6 sm:p-8 md:border-t-0 md:border-l">
              <div>
                <h2 className="text-sm font-semibold">Ежедневный бонус</h2>
                <p className="mt-3 text-2xl font-medium">
                  100{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    монет каждый день
                  </span>
                </p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Получайте бонус вручную. Новый день начинается в 00:00 по
                  Душанбе (UTC+5).
                </p>
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy || wallet.dailyReward.claimed}
                  onClick={() => void claim()}
                  className="min-h-11 w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85 disabled:cursor-default disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100"
                >
                  {busy
                    ? "Получаем…"
                    : wallet.dailyReward.claimed
                      ? "Получено сегодня"
                      : "Получить 100 монет"}
                </button>
                {wallet.dailyReward.claimed && (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Снова доступно {date(wallet.dailyReward.nextClaimAt)} по
                    Душанбе.
                  </p>
                )}
              </div>
            </div>
          </section>
        )
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 text-sm"
        >
          <p className="text-destructive">{error}</p>
          {!wallet && (
            <button
              type="button"
              onClick={() => setRevision((value) => value + 1)}
              className="font-medium underline underline-offset-4"
            >
              Повторить
            </button>
          )}
        </div>
      )}
      <p role="status" className="mt-3 min-h-5 text-sm text-muted-foreground">
        {notice}
      </p>
      <section className="mt-5 border-b pb-7">
        <h2 className="text-sm font-semibold">Подарки авторам</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Когда появятся прямые эфиры, вы сможете отправлять подарки. Их
          стоимость в монетах перейдёт на баланс автора эфира.
        </p>
      </section>
      <CoinHistory key={`${userId}:${historyRevision}`} />
    </div>
  );
}

function CoinHistory() {
  const [items, setItems] = useState<CoinTransaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<string>();
  const epoch = useRef(0);
  useEffect(() => {
    const version = ++epoch.current;
    const controller = new AbortController();
    void createCoinsClient()
      .transactions(page, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || version !== epoch.current) return;
        setLoading(false);
        if (!result.ok) {
          setError(describeFailure(result.failure));
          return;
        }
        setItems((previous) =>
          page
            ? [
                ...previous,
                ...result.data.items.filter(
                  (row) => !previous.some((item) => item.id === row.id),
                ),
              ]
            : result.data.items,
        );
        setCursor(result.data.nextCursor);
      });
    return () => controller.abort();
  }, [page, retry]);
  return (
    <section aria-label="История операций" className="pt-7">
      <h2 className="text-base font-semibold">История операций</h2>
      {!items.length && !loading && !error && (
        <p className="py-8 text-sm text-muted-foreground">
          Здесь будут ваши начисления и подарки.
        </p>
      )}
      <ul className="mt-3 divide-y">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start justify-between gap-4 py-5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {item.kind === "daily_reward"
                  ? "Ежедневный бонус"
                  : item.kind === "gift_sent"
                    ? "Подарок отправлен"
                    : "Подарок получен"}
              </p>
              {item.counterparty && (
                <Link
                  href={`/${item.counterparty.username}`}
                  className="mt-1 block truncate text-xs text-muted-foreground hover:underline"
                >
                  {item.kind === "gift_sent" ? "Для" : "От"} @
                  {item.counterparty.username}
                </Link>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {date(item.createdAt)} · Душанбе
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-medium tabular-nums">
                {item.kind === "gift_sent" ? "−" : "+"}
                {formatCoins(item.amount)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Баланс: {formatCoins(item.balanceAfter)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {loading && (
        <p role="status" className="py-5 text-sm text-muted-foreground">
          Загружаем операции…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 py-5 text-sm"
        >
          <p className="text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(undefined);
              setRetry((value) => value + 1);
            }}
            className="font-medium underline underline-offset-4"
          >
            Повторить загрузку
          </button>
        </div>
      )}
      {cursor && !error && (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setPage(cursor);
          }}
          className="mt-4 rounded-lg border px-5 py-2.5 text-sm font-medium hover:bg-secondary disabled:opacity-50"
        >
          Показать ещё
        </button>
      )}
    </section>
  );
}
