"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { UserProfile } from "@instagram/contracts";

import { ApiErrorNotice } from "@/components/api/api-error-notice";
import { SettingsIcon } from "@/components/icons/ig-icons";
import { DefaultAvatar } from "@/components/ui-ig/avatar";
import { useHomeChecking, useHomeIdentity } from "@/features/auth/home-access";
import { MessageButton } from "@/features/direct/message-button";
import { LiveAvatar, useHostLive } from "@/features/live/live-strip";
import { ProfileGrid } from "@/features/posts/profile-grid";
import type { ApiFailure } from "@/lib/api/client";
import { createSocialClient } from "@/lib/api/social";

import { ProfileFollowActions } from "./profile-follow-actions";
import { UserListDialog } from "./user-list-dialog";

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; failure: ApiFailure }
  | { state: "ready"; profile: UserProfile };

// Russian plural: 1 подписчик, 2 подписчика, 5 подписчиков.
export function plural(count: number, forms: [string, string, string]) {
  const tens = count % 100;
  const ones = count % 10;
  const form =
    tens >= 11 && tens <= 14
      ? forms[2]
      : ones === 1
        ? forms[0]
        : ones >= 2 && ones <= 4
          ? forms[1]
          : forms[2];
  return `${count.toLocaleString("ru-RU")} ${form}`;
}

const secondaryButton =
  "inline-flex h-8 items-center rounded-lg bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80";

export function ProfileView() {
  const { username } = useParams<{ username: string }>();
  // A new username is a new page: drop the previous profile's state.
  return <ProfileContent key={username} username={decodeURIComponent(username)} />;
}

// A stream on air turns the avatar into its live ring (FR-12).
function ProfileAvatar({ profile, viewerId }: { profile: UserProfile; viewerId?: string }) {
  const live = useHostLive(profile.id, true);
  if (!live)
    return (
      <>
        <DefaultAvatar size={150} src={profile.avatarUrl} className="hidden md:flex" />
        <DefaultAvatar size={77} src={profile.avatarUrl} className="md:hidden" />
      </>
    );
  return (
    <>
      <span className="hidden md:flex">
        <LiveAvatar live={live} viewerId={viewerId} size={142} />
      </span>
      <span className="md:hidden">
        <LiveAvatar live={live} viewerId={viewerId} size={70} />
      </span>
    </>
  );
}

function ProfileContent({ username }: { username: string }) {
  const viewer = useHomeIdentity();
  const checking = useHomeChecking();
  const viewerId = viewer?.id;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<"followers" | "following">();

  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    // Refreshes after follow changes keep the current profile on screen.
    void createSocialClient()
      .profile(username, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setLoad({ state: "ready", profile: result.data.profile });
        else if (
          result.failure.kind === "api" &&
          (result.failure.status === 404 || result.failure.status === 400)
        )
          setLoad({ state: "missing" });
        else setLoad({ state: "error", failure: result.failure });
      });
    return () => controller.abort();
  }, [viewerId, username, revision]);

  if (!viewer && !checking)
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">
          Войдите, чтобы смотреть профили.
        </p>
        <Link href="/auth/login" className="font-semibold text-ig-link">
          Войти
        </Link>
      </Centered>
    );
  if (load.state === "loading")
    return (
      <Centered>
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка профиля…
        </p>
      </Centered>
    );
  if (load.state === "missing")
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">
          К сожалению, эта страница недоступна
        </h1>
        <p className="text-sm text-muted-foreground">
          Возможно, ссылка неверная или страница была удалена.{" "}
          <Link href="/" className="text-ig-link">
            Вернуться на главную
          </Link>
        </p>
      </Centered>
    );
  if (load.state === "error")
    return (
      <Centered>
        <ApiErrorNotice
          failure={load.failure}
          onRetry={() => setRevision((value) => value + 1)}
        />
      </Centered>
    );

  const { profile } = load;
  const self = profile.relationship === "self";
  const canSee = self || !profile.isPrivate || profile.relationship === "following";
  const refresh = () => setRevision((value) => value + 1);
  const countClass = "text-left disabled:cursor-default";

  return (
    <div className="mx-auto w-full max-w-233.75 px-4 pt-6 md:px-5 md:pt-8">
      <header className="flex gap-6 md:gap-20 md:px-12">
        <ProfileAvatar profile={profile} viewerId={viewerId} />
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-xl">{profile.username}</h1>
            {self ? (
              <div className="flex items-center gap-2">
                <Link href="/accounts/edit" className={secondaryButton}>
                  Редактировать профиль
                </Link>
                <Link
                  href="/accounts/account"
                  aria-label="Настройки аккаунта"
                  className="rounded-lg p-1 transition-colors hover:bg-secondary"
                >
                  <SettingsIcon />
                </Link>
              </div>
            ) : (
              <>
                <ProfileFollowActions
                  key={profile.relationship}
                  userId={profile.id}
                  username={profile.username}
                  avatarUrl={profile.avatarUrl}
                  isPrivate={profile.isPrivate}
                  relationship={profile.relationship === "self" ? "none" : profile.relationship}
                  onChange={refresh}
                />
                <MessageButton userId={profile.id} />
              </>
            )}
          </div>
          <ul className="flex gap-6 text-sm md:text-base">
            <li>
              <span className="font-semibold">
                {plural(profile.counts.posts, ["публикация", "публикации", "публикаций"])}
              </span>
            </li>
            <li>
              <button
                type="button"
                disabled={!canSee}
                onClick={() => setList("followers")}
                className={countClass}
              >
                {plural(profile.counts.followers, ["подписчик", "подписчика", "подписчиков"])}
              </button>
            </li>
            <li>
              <button
                type="button"
                disabled={!canSee}
                onClick={() => setList("following")}
                className={countClass}
              >
                {plural(profile.counts.following, ["подписка", "подписки", "подписок"])}
              </button>
            </li>
          </ul>
          <div className="text-sm">
            {profile.displayName && (
              <p className="font-semibold">{profile.displayName}</p>
            )}
            {profile.bio && <p className="whitespace-pre-line">{profile.bio}</p>}
          </div>
        </section>
      </header>

      <div className="mt-10 border-t">
        {canSee ? (
          <ProfileGrid key={profile.relationship} userId={profile.id} self={self} />
        ) : (
          <Centered>
            <h2 className="text-base font-semibold">Это закрытый аккаунт</h2>
            <p className="text-sm text-muted-foreground">
              Подпишитесь, чтобы видеть фото и видео этого аккаунта.
            </p>
          </Centered>
        )}
      </div>

      {list && (
        <UserListDialog
          userId={profile.id}
          kind={list}
          removable={self && list === "followers"}
          onRemoved={refresh}
          onClose={() => setList(undefined)}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      {children}
    </div>
  );
}
