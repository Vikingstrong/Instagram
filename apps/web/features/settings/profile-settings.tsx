"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import {
  UpdateOwnProfileRequestSchema,
  type OwnProfile,
  type UpdateOwnProfileRequest,
} from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { DefaultAvatar } from "@/components/ui-ig/avatar";
import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";
import { replaceLocation } from "@/lib/navigation";

import { settingsField, settingsPrimaryButton } from "./settings-shell";
import { useOwnProfile } from "./use-own-profile";

const codePoints = (value: string) => [...value].length;

// FR-03 text profile: username, name and bio. Only changed fields are sent;
// limits mirror the shared contract and the API validates again.
export function ProfileSettings() {
  const { load, retry, saved } = useOwnProfile();
  const [notice, setNotice] = useState(false);
  if (load.state === "loading")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Загрузка…
      </p>
    );
  if (load.state === "error")
    return <ApiErrorNotice failure={load.failure} onRetry={retry} />;
  return (
    <>
      <ProfileForm
        key={JSON.stringify(load.profile)}
        saved={load.profile}
        onEdit={() => setNotice(false)}
        onSaved={(profile) => {
          saved(profile);
          setNotice(true);
        }}
      />
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          Профиль сохранён.
        </p>
      )}
    </>
  );
}

function ProfileForm({
  saved,
  onEdit,
  onSaved,
}: {
  saved: OwnProfile;
  onEdit: () => void;
  onSaved: (profile: OwnProfile) => void;
}) {
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const pending = useRef(false);

  const changes: UpdateOwnProfileRequest = {};
  if (form.username !== saved.username) changes.username = form.username;
  if (form.displayName !== saved.displayName)
    changes.displayName = form.displayName;
  if (form.bio !== saved.bio) changes.bio = form.bio;
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
    onSaved(result.data.profile);
  }

  const set = (patch: Partial<OwnProfile>) => {
    setMessage(undefined);
    onEdit();
    setForm({ ...form, ...patch });
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-150 flex-col gap-6" noValidate>
      <div className="flex items-center gap-4 rounded-2xl bg-secondary p-4">
        <DefaultAvatar size={56} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{saved.username}</p>
          <p className="truncate text-sm text-muted-foreground">
            {saved.displayName || "Имя не указано"}
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Загрузка фото появится вместе с публикациями"
          className="h-8 rounded-lg bg-ig-blue px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Новое фото
        </button>
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-semibold">Имя пользователя</span>
        <input
          className={settingsField}
          value={form.username}
          autoComplete="username"
          onChange={(event) => set({ username: event.target.value })}
        />
        <span className="text-xs text-muted-foreground">
          3–30 символов: латиница, цифры, точка и подчёркивание.
        </span>
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Имя</span>
        <input
          className={settingsField}
          value={form.displayName}
          autoComplete="name"
          onChange={(event) => set({ displayName: event.target.value })}
        />
        <span className="text-right text-xs text-muted-foreground">
          {codePoints(form.displayName)} / 30
        </span>
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">О себе</span>
        <textarea
          className={`${settingsField} min-h-24 resize-y`}
          value={form.bio}
          onChange={(event) => set({ bio: event.target.value })}
        />
        <span className="text-right text-xs text-muted-foreground">
          {codePoints(form.bio)} / 150
        </span>
      </label>
      {!valid && (
        <p role="alert" className="text-sm text-destructive">
          Проверьте введённые данные.
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message.text}
        </p>
      )}
      <div className="flex items-center justify-end gap-4">
        <Link href={`/${saved.username}`} className="text-sm font-semibold text-ig-link">
          К профилю
        </Link>
        <button
          type="submit"
          disabled={!dirty || !valid || saving}
          className={settingsPrimaryButton}
        >
          {saving ? "Сохраняем…" : "Отправить"}
        </button>
      </div>
    </form>
  );
}
