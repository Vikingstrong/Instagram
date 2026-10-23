"use client";

import { useRef, useState } from "react";

import { useHomeIdentity } from "@/features/auth/home-access";
import { LogoutDialog } from "@/features/auth/logout-dialog";
import { createAuthClient } from "@/lib/api/auth";
import { describeFailure } from "@/lib/api/messages";

import { settingsField } from "./settings-shell";

const secondaryButton =
  "h-10 rounded-lg bg-secondary px-5 text-sm font-semibold transition-colors hover:bg-secondary/80 disabled:opacity-60";

// Account data from the session: email and status, a password change through
// the existing recovery mail, and confirmed sign-out.
export function AccountSettings() {
  const user = useHomeIdentity();
  const [logout, setLogout] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);

  if (!user)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Проверяем сессию…
      </p>
    );

  async function requestReset(email: string) {
    if (pending.current) return;
    pending.current = true;
    setSending(true);
    setSent(false);
    setError(undefined);
    const result = await createAuthClient().requestPasswordReset(email);
    pending.current = false;
    setSending(false);
    if (result.ok) setSent(true);
    else setError(describeFailure(result.failure));
  }

  return (
    <div className="flex w-full max-w-150 flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">Данные аккаунта</h2>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Email</span>
          <input className={settingsField} value={user.email} readOnly disabled />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">Имя пользователя</span>
          <input className={settingsField} value={user.username} readOnly disabled />
        </label>
        <p className="flex items-center gap-2 text-sm">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          Email подтверждён
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border p-5">
        <h2 className="font-semibold">Пароль</h2>
        <p className="text-sm text-muted-foreground">
          Мы отправим ссылку для смены пароля на {user.email}. После смены
          пароля вы выйдете на всех устройствах и войдёте заново.
        </p>
        <button
          type="button"
          disabled={sending}
          onClick={() => void requestReset(user.email)}
          className={`${secondaryButton} self-start`}
        >
          {sending ? "Отправляем…" : "Сменить пароль"}
        </button>
        {sent && (
          <p role="status" className="text-sm text-muted-foreground">
            Письмо отправлено. Откройте ссылку из письма, чтобы задать новый
            пароль.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-destructive/30 p-5">
        <h2 className="font-semibold">Выход</h2>
        <p className="text-sm text-muted-foreground">
          Завершить сеанс на этом устройстве. Другие устройства останутся в
          аккаунте.
        </p>
        <button
          type="button"
          onClick={() => setLogout(true)}
          className="h-10 self-start rounded-lg px-5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
        >
          Выйти из аккаунта
        </button>
      </section>

      {logout && (
        <LogoutDialog username={user.username} onClose={() => setLogout(false)} />
      )}
    </div>
  );
}
