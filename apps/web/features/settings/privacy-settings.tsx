"use client";

import { useRef, useState } from "react";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { LockIcon } from "@/components/icons/ig-icons";
import { describeFailure } from "@/lib/api/messages";
import { createSocialClient } from "@/lib/api/social";
import { cn } from "@/lib/utils";

import { useOwnProfile } from "./use-own-profile";

// Private/public switch. Saved immediately; the switch shows the server's
// answer, never an unconfirmed value.
export function PrivacySettings() {
  const { load, retry, saved } = useOwnProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const pending = useRef(false);

  if (load.state === "loading")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Загрузка…
      </p>
    );
  if (load.state === "error")
    return <ApiErrorNotice failure={load.failure} onRetry={retry} />;
  const { isPrivate } = load.profile;

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await createSocialClient().updateProfile({
      isPrivate: !isPrivate,
    });
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    saved(result.data.profile);
    setNotice(
      result.data.profile.isPrivate
        ? "Аккаунт закрыт. Текущие подписчики сохранены."
        : "Аккаунт открыт. Ожидающие запросы приняты.",
    );
  }

  return (
    <div className="flex w-full max-w-150 flex-col gap-4">
      <h2 className="font-semibold">Конфиденциальность аккаунта</h2>
      <div className="flex items-start gap-4 rounded-2xl border p-5">
        <LockIcon className="mt-0.5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p id="private-label" className="font-semibold">
            Закрытый аккаунт
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Если аккаунт закрыт, публикации и списки подписок видят только
            одобренные вами подписчики. Имя, фото, описание и счётчики видны
            всем. При открытии аккаунта все ожидающие запросы будут приняты.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          aria-labelledby="private-label"
          disabled={busy}
          onClick={() => void toggle()}
          className={cn(
            "relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60",
            isPrivate ? "bg-foreground" : "bg-muted-foreground/40",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-6 rounded-full bg-background shadow transition-transform",
              isPrivate && "translate-x-5",
            )}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
