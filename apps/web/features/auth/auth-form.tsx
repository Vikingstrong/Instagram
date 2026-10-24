"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  AuthLoginRequestSchema,
  AuthRegisterRequestSchema,
} from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { createAuthClient } from "@/lib/api/auth";
import { replaceLocation } from "@/lib/navigation";
import type { ApiFailure } from "@/lib/api/client";

import { authButtonClass, authInputClass as inputClass } from "./auth-design";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure>();
  const [invalid, setInvalid] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      const result =
        registering &&
        "username" in parsed.data &&
        typeof parsed.data.username === "string"
          ? await auth.register({
              ...parsed.data,
              username: parsed.data.username,
            })
          : await auth.login(parsed.data);
      if (!result.ok) setFailure(result.failure);
      else {
        // Registration and login both return a signed-in user. A document
        // navigation drops the previous account's React/router state; cookies
        // remain API-owned and HttpOnly, nothing is persisted here.
        replaceLocation("/");
      }
    } finally {
      const password = form.elements.namedItem("password");
      if (password instanceof HTMLInputElement) password.value = "";
      setShowPassword(false);
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <p className="auth-eyebrow mb-3">
        {registering ? "Начните свою историю" : "С возвращением"}
      </p>
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">
        {registering ? "Создайте аккаунт" : "Войти в Instagram"}
      </h1>
      <p className="mb-8 text-sm leading-6 text-muted-foreground">
        {registering
          ? "Самое интересное начинается с вас. Создайте аккаунт — и оставайтесь на связи."
          : "Ваши люди и любимые моменты уже здесь."}
      </p>
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        <fieldset disabled={busy} className="space-y-4">
          <div className="block text-sm">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className={inputClass}
              name="email"
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </div>
          {registering && (
            <div className="block text-sm">
              <label htmlFor="auth-username">Имя пользователя</label>
              <input
                id="auth-username"
                className={inputClass}
                placeholder="Ваше имя пользователя"
                name="username"
                autoComplete="username"
                required
                aria-describedby="username-help"
              />
              <span
                id="username-help"
                className="mt-2 block text-muted-foreground"
              >
                3–30 латинских букв, цифр, точек или подчёркиваний.
              </span>
            </div>
          )}
          <div className="block text-sm">
            <label htmlFor="auth-password">Пароль</label>
            <div className="relative">
              <input
                id="auth-password"
                className={`${inputClass} pr-24`}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                required
                aria-describedby="password-help"
                placeholder={
                  registering ? "Не менее 8 символов" : "Введите пароль"
                }
              />
              <button
                type="button"
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-4 mt-2 text-xs font-semibold text-[#4a5df9] dark:text-[#adb8ff]"
              >
                {showPassword ? "Скрыть" : "Показать"}
              </button>
            </div>
            <span
              id="password-help"
              className="mt-2 block text-xs text-muted-foreground"
            >
              8–128 символов. Пробелы и Unicode разрешены.
            </span>
          </div>
        </fieldset>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            Проверьте email, пароль и{" "}
            {registering ? "имя пользователя" : "длину пароля"}. Пробелы в
            начале и конце сохраняются.
          </p>
        )}
        {failure && <ApiErrorNotice failure={failure} />}
        {/* One generic error for unknown emails and wrong passwords (no account
            enumeration); point to the likely next step instead. */}
        {!registering &&
          failure?.kind === "api" &&
          failure.error.code === "INVALID_CREDENTIALS" && (
            <p className="text-sm text-muted-foreground">
              Нет аккаунта?{" "}
              <Link
                href="/auth/register"
                className="font-semibold text-ig-link underline"
              >
                Зарегистрируйтесь
              </Link>
            </p>
          )}
        <button className={authButtonClass} disabled={busy} type="submit">
          {busy ? "Подождите…" : registering ? "Создать аккаунт" : "Войти"}
        </button>
      </form>
      {!registering && (
        <Link
          href="/auth/forgot-password"
          className="mt-5 block text-center text-sm text-ig-link underline"
        >
          Забыли пароль?
        </Link>
      )}
      <div className="my-7 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-foreground/10" />
        или
        <span className="h-px flex-1 bg-foreground/10" />
      </div>
      <Link
        href={registering ? "/auth/login" : "/auth/register"}
        className="flex min-h-12 items-center justify-center rounded-full border border-[#708dff]/70 px-4 text-sm font-semibold text-[#4a5df9] dark:text-[#adb8ff] transition hover:bg-[#708dff]/10"
      >
        {registering ? "Уже есть аккаунт? Войти" : "Создать новый аккаунт"}
      </Link>
      <Link
        href="/?guest=1"
        className="mt-5 block text-center text-sm text-muted-foreground transition hover:text-foreground"
      >
        Продолжить как гость <span aria-hidden="true">↗</span>
      </Link>
    </>
  );
}
