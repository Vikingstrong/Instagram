"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Coins } from "lucide-react";
import { createCoinsClient, formatCoins } from "@/lib/api/coins";

import {
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/icons/ig-icons";
import { useHomeIdentity } from "@/features/auth/home-access";
import { LogoutDialog } from "@/features/auth/logout-dialog";

const itemClass =
  "flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-sm transition-colors hover:bg-secondary";

// "Ещё" in the desktop rail: settings, own profile and confirmed sign-out.
// Closes on Escape and outside clicks.
export function MoreMenu({
  label,
  compact = false,
}: {
  label?: ReactNode;
  compact?: boolean;
}) {
  const user = useHomeIdentity();
  const [open, setOpen] = useState(false);
  const [logout, setLogout] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [balanceState, setBalanceState] = useState<{
    owner: string;
    amount: string;
  }>();
  const balance =
    balanceState?.owner === user?.id ? balanceState?.amount : undefined;
  const userId = user?.id;
  useEffect(() => {
    if (!open || !userId) return;
    const controller = new AbortController();
    void createCoinsClient()
      .wallet(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && result.ok)
          setBalanceState({
            owner: userId,
            amount: result.data.wallet.balance,
          });
      });
    return () => controller.abort();
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Ещё"
          className={`${compact ? "fixed top-16 right-4" : "fixed bottom-20 left-3"} z-60 w-66 rounded-2xl border bg-ig-elevated p-2 shadow-[0_4px_24px_rgb(0_0_0/0.35)]`}
        >
          {user && (
            <>
              <Link
                role="menuitem"
                href="/coins"
                className={itemClass}
                onClick={() => setOpen(false)}
              >
                <Coins aria-hidden className="size-5" />
                <span className="flex-1">Получить монеты</span>
                {balance !== undefined && (
                  <span
                    className="max-w-20 truncate text-xs text-muted-foreground"
                    aria-label={`Баланс ${balance}`}
                  >
                    {formatCoins(balance)}
                  </span>
                )}
              </Link>
              <Link
                role="menuitem"
                href="/accounts/edit"
                className={itemClass}
                onClick={() => setOpen(false)}
              >
                <SettingsIcon className="size-5" />
                Настройки
              </Link>
              <Link
                role="menuitem"
                href={`/${user.username}`}
                className={itemClass}
                onClick={() => setOpen(false)}
              >
                <UserIcon className="size-5" />
                Ваш профиль
              </Link>
              <div className="my-2 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  setLogout(true);
                }}
              >
                <LogoutIcon className="size-5" />
                Выйти
              </button>
            </>
          )}
          {!user && (
            <Link role="menuitem" href="/auth/login" className={itemClass}>
              Войти
            </Link>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label={compact ? "Ещё" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setBalanceState(undefined);
          setOpen((value) => !value);
        }}
        className={
          compact
            ? "grid size-10 place-items-center rounded-full hover:bg-secondary active:opacity-60"
            : "flex h-12 w-full items-center gap-4 rounded-lg px-3 transition-colors hover:bg-secondary active:opacity-60"
        }
      >
        <MenuIcon />
        {label}
      </button>
      {logout && (
        <LogoutDialog
          username={user?.username}
          onClose={() => setLogout(false)}
        />
      )}
    </div>
  );
}
