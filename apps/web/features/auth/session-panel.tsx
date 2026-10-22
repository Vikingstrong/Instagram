"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authEndpoints, AuthSessionResponseSchema, type AuthUser } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { createAuthClient } from "@/lib/api/auth";
import { replaceLocation } from "@/lib/navigation";
import { createApiClient, type ApiFailure } from "@/lib/api/client";
import { authButtonClass } from "./auth-design";

type Session = { state: "loading" } | { state: "ready"; user: AuthUser | null } | { state: "error"; failure: ApiFailure };

export function SessionPanel() {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure>();
  const [resent, setResent] = useState(false);
  const [resendFailure, setResendFailure] = useState<ApiFailure>();
  const pending = useRef(false);
  const resending = useRef(false);
  const awaitingVerification = useRef(false);
  const cancel = useRef<() => void>(() => {});
  const reload = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    async function load() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      cancel.current = () => controller.abort();
      const result = await createApiClient().request(authEndpoints.session, AuthSessionResponseSchema, { signal: controller.signal });
      if (!active || controller.signal.aborted || pending.current) return;
      const user = result.ok ? result.data.user : null;
      // Confirmed in another tab while this page waited: go straight to the feed.
      if (user?.emailVerified && awaitingVerification.current) {
        replaceLocation("/");
        return;
      }
      awaitingVerification.current = !!user && !user.emailVerified;
      setSession(result.ok ? { state: "ready", user } : { state: "error", failure: result.failure });
    }
    function refresh() {
      if (pending.current) return;
      // Hide any previous identity while checking a potentially changed cookie.
      setSession({ state: "loading" });
      setFailure(undefined);
      void load();
    }
    function visibility() {
      if (document.visibilityState === "hidden") {
        request?.abort();
        setSession({ state: "loading" });
      } else refresh();
    }
    reload.current = refresh;
    void load();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      request?.abort();
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  async function logout() {
    if (pending.current) return;
    pending.current = true;
    cancel.current();
    setBusy(true);
    // Clear identity before the request; a failed logout never claims success.
    setSession({ state: "loading" });
    setFailure(undefined);
    const result = await createAuthClient().logout();
    if (result.ok) replaceLocation("/auth/login");
    else {
      setFailure(result.failure);
      setSession({ state: "ready", user: null });
    }
    pending.current = false;
    setBusy(false);
  }

  // Resend to the signed-in account's own address: no separate email form.
  async function resend(email: string) {
    if (resending.current) return;
    resending.current = true;
    setResent(false);
    setResendFailure(undefined);
    const result = await createAuthClient().requestVerification(email);
    if (result.ok) setResent(true);
    else setResendFailure(result.failure);
    resending.current = false;
  }

  const unverified = session.state === "ready" && session.user && !session.user.emailVerified;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{unverified ? "Подтвердите email" : "Ваш аккаунт"}</h1>
      {failure && <><ApiErrorNotice failure={failure} /><button type="button" className={authButtonClass} onClick={logout} disabled={busy}>Повторить выход</button></>}
      {session.state === "loading" && <p role="status">{busy ? "Выходим…" : "Проверяем сессию…"}</p>}
      {session.state === "error" && <ApiErrorNotice failure={session.failure} onRetry={() => reload.current()} />}
      {session.state === "ready" && session.user && <>
        <p className="break-words font-semibold">{session.user.username}</p>
        <p className="break-words text-muted-foreground">{session.user.email}</p>
        {session.user.emailVerified ? <>
          <p role="status">Email подтверждён.</p>
          <Link href="/" className={authButtonClass}>Перейти к ленте</Link>
        </> : <>
          <p role="status">Мы отправили ссылку на этот адрес. Откройте письмо и нажмите на ссылку — после этого вы сразу попадёте в ленту. Проверьте также папку «Спам».</p>
          <button type="button" onClick={() => void resend(session.user!.email)} className="block text-ig-link underline">Отправить письмо повторно</button>
          {resent && <p role="status" className="text-sm text-muted-foreground">Письмо отправлено повторно. Новое письмо можно запросить не чаще раза в минуту.</p>}
          {resendFailure && <ApiErrorNotice failure={resendFailure} />}
        </>}
        <button type="button" className={authButtonClass} onClick={logout} disabled={busy}>Выйти</button>
      </>}
      {session.state === "ready" && !session.user && !failure && <>
        <p>Вы не вошли в аккаунт.</p>
        <Link href="/auth/login" className="text-ig-link underline">Войти</Link>
      </>}
    </div>
  );
}
