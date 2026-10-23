"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
export function MoreMenu({ label }: { label: ReactNode }) {
  const user = useHomeIdentity();
  const [open, setOpen] = useState(false);
  const [logout, setLogout] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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
          className="fixed bottom-20 left-3 z-60 w-66 rounded-2xl bg-ig-elevated p-2 shadow-[0_4px_24px_rgb(0_0_0/0.35)]"
        >
          {user && (
            <>
              <Link role="menuitem" href="/accounts/edit" className={itemClass} onClick={() => setOpen(false)}>
                <SettingsIcon className="size-5" />
                Настройки
              </Link>
              <Link role="menuitem" href={`/${user.username}`} className={itemClass} onClick={() => setOpen(false)}>
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
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-full items-center gap-4 rounded-lg px-3 transition-colors hover:bg-secondary active:opacity-60"
      >
        <MenuIcon />
        {label}
      </button>
      {logout && (
        <LogoutDialog username={user?.username} onClose={() => setLogout(false)} />
      )}
    </div>
  );
}
