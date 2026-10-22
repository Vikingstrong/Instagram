"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  UpdateOwnProfileRequestSchema,
  type OwnProfile,
  type UpdateOwnProfileRequest,
} from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { useHomeIdentity } from "@/features/auth/home-access";
import type { ApiFailure } from "@/lib/api/client";
import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";
import { replaceLocation } from "@/lib/navigation";

const fieldClass =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground";
const codePoints = (value: string) => [...value].length;

type Load =
  | { state: "loading" }
  | { state: "error"; failure: ApiFailure }
  | { state: "ready"; profile: OwnProfile };

// FR-03 text settings: username, name, bio and privacy. Only changed fields
// are sent; limits mirror the shared contract, the API validates again.
export function ProfileSettings() {
  const viewer = useHomeIdentity();
  const viewerId = viewer?.id;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<OwnProfile>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const pending = useRef(false);

  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    void createSocialClient()
      .ownProfile(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setLoad({ state: "error", failure: result.failure });
          return;
        }
        setLoad({ state: "ready", profile: result.data.profile });
        setForm(result.data.profile);
      });
    return () => controller.abort();
  }, [viewerId, revision]);

  if (load.state === "loading" || !form)
    return load.state === "error" ? (
      <Frame>
        <ApiErrorNotice
          failure={load.failure}
          onRetry={() => setRevision((value) => value + 1)}
        />
      </Frame>
    ) : (
      <Frame>
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка…
        </p>
      </Frame>
    );
  if (load.state !== "ready") return null;
  const saved = load.profile;

  const changes: UpdateOwnProfileRequest = {};
  if (form.username !== saved.username) changes.username = form.username;
  if (form.displayName !== saved.displayName)
    changes.displayName = form.displayName;
  if (form.bio !== saved.bio) changes.bio = form.bio;
  if (form.isPrivate !== saved.isPrivate) changes.isPrivate = form.isPrivate;
  const dirty = Object.keys(changes).length > 0;
  const valid = !dirty || UpdateOwnProfileRequestSchema.safeParse(changes).success;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !dirty || !valid) return;
    pending.current = true;
    setSaving(true);
    setMessage(undefined);
    const result = await createSocialClient().updateProfile(changes);
    pending.current = false;
    setSaving(false);
    if (!result.ok) {
      setMessage({ ok: false, text: describeFailure(result.failure) });
      return;
    }
    // A new username changes the session identity shown across the app.
    if (changes.username) {
      replaceLocation(`/${result.data.profile.username}`);
      return;
    }
    setLoad({ state: "ready", profile: result.data.profile });
    setForm(result.data.profile);
    setMessage({ ok: true, text: "Профиль сохранён." });
  }

  const set = (patch: Partial<OwnProfile>) => {
    setMessage(undefined);
    setForm({ ...form, ...patch });
  };

  return (
    <Frame>
      <form onSubmit={submit} className="flex w-full flex-col gap-6" noValidate>
        <label className="flex flex-col gap-2">
          <span className="text-base font-semibold">Имя пользователя</span>
          <input
            className={fieldClass}
            value={form.username}
            autoComplete="username"
            onChange={(event) => set({ username: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            3–30 символов: латиница, цифры, точка и подчёркивание.
          </span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base font-semibold">Имя</span>
          <input
            className={fieldClass}
            value={form.displayName}
            autoComplete="name"
            onChange={(event) => set({ displayName: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            {codePoints(form.displayName)} / 30
          </span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base font-semibold">О себе</span>
          <textarea
            className={`${fieldClass} min-h-24 resize-y`}
            value={form.bio}
            onChange={(event) => set({ bio: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            {codePoints(form.bio)} / 150
          </span>
        </label>
        <label className="flex items-start justify-between gap-4 rounded-2xl border p-4">
          <span>
            <span className="block text-base font-semibold">
              Закрытый аккаунт
            </span>
            <span className="block text-xs text-muted-foreground">
              Публикации видят только одобренные подписчики. При открытии
              аккаунта все ожидающие запросы будут приняты.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="mt-1 size-5 accent-ig-blue"
            checked={form.isPrivate}
            onChange={(event) => set({ isPrivate: event.target.checked })}
          />
        </label>
        {!valid && (
          <p role="alert" className="text-sm text-destructive">
            Проверьте введённые данные.
          </p>
        )}
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}
          >
            {message.text}
          </p>
        )}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={!dirty || !valid || saving}
            className="h-11 rounded-lg bg-ig-blue px-8 text-sm font-semibold text-white hover:bg-ig-blue-hover disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Отправить"}
          </button>
          <Link href={`/${saved.username}`} className="text-sm font-semibold text-ig-link">
            К профилю
          </Link>
        </div>
      </form>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-175 flex-col gap-8 px-4 py-8 md:px-8">
      <h1 className="text-xl font-bold">Редактировать профиль</h1>
      {children}
    </div>
  );
}
