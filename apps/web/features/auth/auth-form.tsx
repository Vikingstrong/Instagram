"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { AuthLoginRequestSchema, AuthRegisterRequestSchema } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { createAuthClient } from "@/lib/api/auth";
import type { ApiFailure } from "@/lib/api/client";

const inputClass = "mt-2 w-full rounded-lg border bg-secondary p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ig-blue";
export const authButtonClass = "w-full cursor-pointer rounded-lg bg-ig-blue px-4 py-3 font-semibold text-white hover:bg-ig-blue-hover focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-wait disabled:opacity-50";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure>();
  const [invalid, setInvalid] = useState(false);
  const [registered, setRegistered] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      ...(registering ? { username: String(data.get("username") ?? "") } : {}),
    };
    const parsed = registering
      ? AuthRegisterRequestSchema.safeParse(body)
      : AuthLoginRequestSchema.safeParse(body);
    setFailure(undefined);
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    pending.current = true;
    setBusy(true);
    try {
      const auth = createAuthClient();
      const result = registering && "username" in parsed.data && typeof parsed.data.username === "string"
        ? await auth.register({ ...parsed.data, username: parsed.data.username })
        : await auth.login(parsed.data);
      if (!result.ok) setFailure(result.failure);
      else if (registering) {
        form.reset();
        setRegistered(true);
      } else {
        // A document navigation drops the previous account's React/router state.
        // Cookies remain API-owned and HttpOnly; no user/token persistence here.
        window.location.replace("/auth/session");
      }
    } finally {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      pending.current = false;
      setBusy(false);
    }
  }

  if (registered) return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Аккаунт создан</h1>
      <p role="status">Письмо подтверждения поставлено в очередь. Проверьте входящие и папку «Спам». Основные функции откроются после подтверждения email.</p>
      <Link href="/auth/request-verification" className="block text-ig-link underline">Отправить письмо повторно</Link>
      <Link href="/auth/login" className="text-ig-link underline">Войти в аккаунт</Link>
    </div>
  );

  return (
    <>
      <h1 className="mb-6 text-center text-2xl font-semibold">{registering ? "Регистрация" : "Вход"}</h1>
      <form onSubmit={submit} noValidate className="space-y-5" aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-5">
          <div className="block text-sm"><label htmlFor="auth-email">Email</label>
            <input id="auth-email" className={inputClass} name="email" type="email" autoComplete="email" required maxLength={254} />
          </div>
          {registering && <div className="block text-sm"><label htmlFor="auth-username">Имя пользователя</label>
            <input id="auth-username" className={inputClass} name="username" autoComplete="username" required aria-describedby="username-help" />
            <span id="username-help" className="mt-2 block text-muted-foreground">3–30 латинских букв, цифр, точек или подчёркиваний.</span>
          </div>}
          <div className="block text-sm"><label htmlFor="auth-password">Пароль</label>
            <input id="auth-password" className={inputClass} name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required aria-describedby="password-help" />
            <span id="password-help" className="mt-2 block text-muted-foreground">12–128 символов. Пробелы и Unicode разрешены.</span>
          </div>
        </fieldset>
        {invalid && <p role="alert" className="text-sm text-destructive">Проверьте email, пароль и {registering ? "имя пользователя" : "длину пароля"}. Пробелы в начале и конце сохраняются.</p>}
        {failure && <ApiErrorNotice failure={failure} />}
        <button className={authButtonClass} disabled={busy} type="submit">{busy ? "Подождите…" : registering ? "Создать аккаунт" : "Войти"}</button>
      </form>
      {!registering && <Link href="/auth/forgot-password" className="mt-5 block text-center text-sm text-ig-link underline">Забыли пароль?</Link>}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {registering ? "Уже есть аккаунт? " : "Нет аккаунта? "}
        <Link href={registering ? "/auth/login" : "/auth/register"} className="text-ig-link underline">{registering ? "Войти" : "Зарегистрироваться"}</Link>
      </p>
    </>
  );
}
