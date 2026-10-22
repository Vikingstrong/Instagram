"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthEmailRequestSchema, AuthLinkTokenSchema, AuthPasswordSchema } from "@instagram/contracts";
import { createAuthClient } from "@/lib/api/auth";
import type { ApiFailure } from "@/lib/api/client";
import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { authInputClass as inputClass, authButtonClass } from "./auth-design";

type Mode = "request-verification" | "forgot-password" | "verify" | "reset-password";
const titles: Record<Mode, string> = {
  "request-verification": "Подтверждение email",
  "forgot-password": "Восстановление пароля",
  verify: "Подтвердить email",
  "reset-password": "Новый пароль",
};

export function EmailForm({ mode }: { mode: Mode }) {
  const request = mode === "request-verification" || mode === "forgot-password";
  const pending = useRef(false);
  const capturedToken = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<ApiFailure>();
  const [done, setDone] = useState(false);
  useEffect(() => {
    alive.current = true;
    let active = true;
    function capture() {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      capturedToken.current = AuthLinkTokenSchema.safeParse(value).success ? value! : "";
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    function changed() {
      if (!window.location.hash) return;
      capture();
      setToken(capturedToken.current);
      setDone(false);
      setFailure(undefined);
      setInvalid(false);
    }
    if (!request) {
      // StrictMode replays effects after the initial fragment is removed.
      if (capturedToken.current === undefined) capture();
      queueMicrotask(() => { if (active) setToken(capturedToken.current); });
      window.addEventListener("hashchange", changed);
    }
    return () => {
      active = false;
      alive.current = false;
      window.removeEventListener("hashchange", changed);
    };
  }, [request]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const valid = request ? AuthEmailRequestSchema.safeParse({ email }).success
      : AuthLinkTokenSchema.safeParse(token).success && (mode !== "reset-password" || AuthPasswordSchema.safeParse(password).success);
    setInvalid(!valid);
    setFailure(undefined);
    if (!valid) return;
    pending.current = true;
    setBusy(true);
    const submittedToken = token;
    try {
      const auth = createAuthClient();
      const result = mode === "request-verification" ? await auth.requestVerification(email)
        : mode === "forgot-password" ? await auth.requestPasswordReset(email)
        : mode === "verify" ? await auth.verify(token!) : await auth.resetPassword(token!, password);
      if (!alive.current || (!request && capturedToken.current !== submittedToken)) return;
      if (!result.ok) setFailure(result.failure);
      else if (mode === "reset-password") {
        // Drop any state of the account whose sessions were just revoked.
        window.location.replace("/auth/password-changed");
      } else {
        setToken("");
        form.reset();
        setDone(true);
      }
    } finally {
      const field = form.elements.namedItem("password");
      if (field instanceof HTMLInputElement) field.value = "";
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">{titles[mode]}</h1>
    {done ? <>
      <p role="status">{mode === "verify" ? "Email подтверждён. Теперь можно войти в аккаунт или проверить текущую сессию." : "Если для этого адреса доступно действие, письмо будет отправлено. Проверьте входящие и папку «Спам». Повторная отправка доступна не чаще раза в минуту."}</p>
      {mode === "verify" && <Link href="/auth/session" className="block text-ig-link underline">Проверить сессию</Link>}
    </> : <form onSubmit={submit} noValidate className="space-y-5" aria-busy={busy}>
      {request && <div><label htmlFor="request-email">Email</label><input id="request-email" className={inputClass} name="email" type="email" autoComplete="email" required disabled={busy} /></div>}
      {!request && token === undefined && <p role="status">Проверяем ссылку…</p>}
      {!request && token === "" && <p role="alert">В ссылке нет действительного токена. Запросите новое письмо.</p>}
      {mode === "reset-password" && <div><label htmlFor="reset-password">Новый пароль</label><input id="reset-password" className={inputClass} name="password" type="password" autoComplete="new-password" required disabled={busy} aria-describedby="reset-help" /><p id="reset-help" className="mt-2 text-sm text-muted-foreground">8–128 символов. Пробелы и Unicode разрешены. После смены пароля потребуется новый вход на всех устройствах.</p></div>}
      {mode === "verify" && token && <p>Нажмите кнопку, чтобы подтвердить адрес email.</p>}
      {invalid && <p role="alert">Проверьте введённые данные и ссылку из письма.</p>}
      {failure && <ApiErrorNotice failure={failure} />}
      <button className={authButtonClass} type="submit" disabled={busy || (!request && !token)}>{busy ? "Подождите…" : request ? "Отправить письмо" : mode === "verify" ? "Подтвердить email" : "Сохранить пароль"}</button>
    </form>}
    {!request && <Link href={mode === "verify" ? "/auth/request-verification" : "/auth/forgot-password"} className="block text-ig-link underline">Запросить новое письмо</Link>}
    <Link href="/auth/login" className="block text-ig-link underline">Войти в аккаунт</Link>
  </div>;
}
