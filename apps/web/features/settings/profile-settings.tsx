"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  imageUploadRules,
  UpdateOwnProfileRequestSchema,
  type OwnProfile,
  type UpdateOwnProfileRequest,
} from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { DefaultAvatar } from "@/components/ui-ig/avatar";
import { describeFailure } from "@/lib/api/messages";
import { checkImageFile, createPostsClient, type PostsClient } from "@/lib/api/posts";
import { createSocialClient } from "@/lib/api/social";
import { replaceLocation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

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
      <AvatarCard
        profile={load.profile}
        onChange={(url) => saved({ ...load.profile, avatarUrl: url })}
      />
      {/* A new photo must not reset text the user is still editing. */}
      <ProfileForm
        key={JSON.stringify({ ...load.profile, avatarUrl: undefined })}
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
      <Field
        id="settings-username"
        label="Имя пользователя"
        hint="3–30 символов: латиница, цифры, точка и подчёркивание."
      >
        {(props) => (
          <input
            {...props}
            className={settingsField}
            value={form.username}
            autoComplete="username"
            onChange={(event) => set({ username: event.target.value })}
          />
        )}
      </Field>
      <Field
        id="settings-name"
        label="Имя"
        hint={`${codePoints(form.displayName)} / 30`}
        counter
      >
        {(props) => (
          <input
            {...props}
            className={settingsField}
            value={form.displayName}
            autoComplete="name"
            onChange={(event) => set({ displayName: event.target.value })}
          />
        )}
      </Field>
      <Field
        id="settings-bio"
        label="О себе"
        hint={`${codePoints(form.bio)} / 150`}
        counter
      >
        {(props) => (
          <textarea
            {...props}
            className={`${settingsField} min-h-24 resize-y`}
            value={form.bio}
            onChange={(event) => set({ bio: event.target.value })}
          />
        )}
      </Field>
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

// Profile photo (FR-03): upload replaces the previous one at once, removal
// returns to the silhouette. The API checks the file like a post photo.
function AvatarCard({
  profile,
  onChange,
}: {
  profile: OwnProfile;
  onChange: (avatarUrl: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);

  async function run(action: () => ReturnType<PostsClient["removeAvatar"]>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    const result = await action();
    pending.current = false;
    setBusy(false);
    if (result.ok) onChange(result.data.avatarUrl);
    else setMessage(describeFailure(result.failure));
  }

  function upload(file: File | undefined) {
    if (!file) return;
    const problem = checkImageFile(file);
    if (problem) {
      setMessage(problem);
      return;
    }
    void run(() => createPostsClient().setAvatar(file));
  }

  return (
    <div className="flex w-full max-w-150 flex-col gap-2">
      <div className="flex items-center gap-4 rounded-2xl bg-secondary p-4">
        <DefaultAvatar size={56} src={profile.avatarUrl} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{profile.username}</p>
          <p className="truncate text-sm text-muted-foreground">
            {profile.displayName || "Имя не указано"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="h-8 rounded-lg bg-ig-blue px-4 text-sm font-semibold text-white hover:bg-ig-blue-hover disabled:opacity-50"
          >
            {busy ? "Подождите…" : "Новое фото"}
          </button>
          {profile.avatarUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => createPostsClient().removeAvatar())}
              className="text-xs font-semibold text-destructive disabled:opacity-50"
            >
              Удалить фото
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={imageUploadRules.formats.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label="Фото профиля"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

// Label names the control; hints and counters are its description, so the
// accessible name stays exactly the label text.
function Field({
  id,
  label,
  hint,
  counter,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  counter?: boolean;
  children: (props: { id: string; "aria-describedby": string }) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children({ id, "aria-describedby": `${id}-hint` })}
      <span
        id={`${id}-hint`}
        className={cn("text-xs text-muted-foreground", counter && "text-right")}
      >
        {hint}
      </span>
    </div>
  );
}
