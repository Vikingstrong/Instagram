"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { authEndpoints, AuthSessionResponseSchema, type AuthUser } from "@instagram/contracts";
import { createApiClient, type ApiFailure } from "@/lib/api/client";
import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { AuthBrand, authButtonClass } from "./auth-design";

const HomeIdentity = createContext<AuthUser | null>(null);
export const useHomeIdentity = () => useContext(HomeIdentity);
type Access = { state: "loading" } | { state: "error"; failure: ApiFailure } | { state: "ready"; user: AuthUser | null };

// Guest selection changes presentation only. Protected API routes still require
// their own verified session; a URL parameter never grants server permissions.
export function HomeAccess({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>({ state: "loading" });
  const [prompt, setPrompt] = useState(false);
  const [revision, setRevision] = useState(0);
  const modal = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    async function refresh() {
      const version = ++generation.current;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      setAccess({ state: "loading" });
      setPrompt(false);
      const result = await createApiClient().request(authEndpoints.session, AuthSessionResponseSchema, { signal: controller.signal });
      if (!active || controller.signal.aborted || version !== generation.current) return;
      if (!result.ok) { setAccess({ state: "error", failure: result.failure }); return; }
      if (result.data.user && !result.data.user.emailVerified) {
        window.location.replace("/auth/session"); return;
      }
      if (!result.data.user && new URLSearchParams(window.location.search).get("guest") !== "1") {
        window.location.replace("/auth/login"); return;
      }
      // The account key remounts the feed when the cookie changes identity.
      setAccess({ state: "ready", user: result.data.user });
    }
    function visibility() {
      if (document.visibilityState === "hidden") {
        ++generation.current;
        request?.abort();
        setAccess({ state: "loading" });
        setPrompt(false);
      } else void refresh();
    }
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      request?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [revision]);

  useEffect(() => {
    if (prompt) modal.current?.showModal();
    else modal.current?.close();
  }, [prompt]);

  function interact(event: MouseEvent<HTMLDivElement>) {
    if (access.state !== "ready" || access.user || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>("[data-auth-required], a");
    if (!target) return;
    if (target instanceof HTMLAnchorElement) {
      const url = new URL(target.href, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/auth/")) {
        if (url.pathname !== "/auth/session") return;
      } else if (url.pathname === "/") {
        if (url.hash) return;
        // Keep the explicit guest choice when returning home.
        event.preventDefault();
        event.stopPropagation();
        window.location.assign("/?guest=1");
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    setPrompt(true);
  }

  if (access.state === "loading") return <main className="grid min-h-dvh place-content-center gap-6 text-center"><AuthBrand /><p role="status" className="text-sm text-muted-foreground">Проверяем сессию…</p></main>;
  if (access.state === "error") return <main className="mx-auto grid min-h-dvh max-w-sm place-content-center gap-6 px-6"><AuthBrand /><ApiErrorNotice failure={access.failure} onRetry={() => setRevision(value => value + 1)} /><Link href="/auth/login" className="text-ig-link">Перейти ко входу</Link></main>;
  return <HomeIdentity value={access.user}>
    <div key={access.user?.id ?? "guest"} onClickCapture={interact}>{children}</div>
    <dialog ref={modal} onCancel={() => setPrompt(false)} onClose={() => setPrompt(false)} aria-labelledby="guest-prompt-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border bg-[#1b1e24] p-7 text-center text-white shadow-2xl backdrop:bg-black/70">
      <h2 id="guest-prompt-title" className="text-2xl font-semibold">Будьте частью момента</h2>
      <p className="mt-3 mb-6 text-sm leading-6 text-muted-foreground">Войдите, чтобы ставить лайки, подписываться и общаться.</p>
      <Link href="/auth/login" className={authButtonClass}>Войти</Link>
      <Link href="/auth/register" className="mt-4 block text-sm font-semibold text-[#adb8ff]">Создать аккаунт</Link>
      <button type="button" onClick={() => setPrompt(false)} className="mt-6 text-sm text-muted-foreground">Продолжить просмотр</button>
    </dialog>
  </HomeIdentity>;
}
