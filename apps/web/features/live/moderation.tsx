"use client";

import { useRef, useState, type ReactNode } from "react";
import { Shield, X } from "lucide-react";
import type {
  CreateLiveRestrictionRequest,
  LiveRestriction,
  LiveViewerAccess,
  UserSummary,
} from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { openModal } from "@/components/ui-ig/confirm-dialog";
import type { ApiResult } from "@/lib/api/client";
import { createLivesClient } from "@/lib/api/lives";
import { describeFailure } from "@/lib/api/messages";

import { roundButton } from "./live-stage";

// Counterpart of openModal for engines without HTMLDialogElement.close.
export function closeModal(node: HTMLDialogElement | null) {
  if (!node) return;
  if (typeof node.close === "function") node.close();
  else node.removeAttribute("open");
}

export type Moderation = {
  hostId: string;
  role: LiveViewerAccess["role"];
};
export const canModerate = (moderation?: Moderation) =>
  !!moderation && moderation.role !== "viewer";

const mutes: { label: string; minutes: 5 | 60 | 1440 | null }[] = [
  { label: "Мут на 5 минут", minutes: 5 },
  { label: "Мут на 1 час", minutes: 60 },
  { label: "Мут на 24 часа", minutes: 1440 },
  { label: "Мут навсегда", minutes: null },
];

// "до 18:05" or "навсегда" for a mute shown to the muted user.
export function muteTerm(muted: NonNullable<LiveViewerAccess["muted"]>) {
  return muted.until
    ? `до ${new Date(muted.until).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : "навсегда";
}

// Actions on a user, from the chat or the viewer list: the host and
// moderators mute and ban; the host also appoints moderators. The API
// decides who may act on whom.
export function ModerationMenu({
  moderation,
  user,
  onDone,
}: {
  moderation: Moderation;
  user: UserSummary;
  onDone?: (message: string) => void;
}) {
  const [error, setError] = useState<string>();
  // A modal, not a popover: the chat list would clip a popover.
  const dialog = useRef<HTMLDialogElement>(null);

  async function act(run: () => Promise<ApiResult<unknown>>, done: string) {
    setError(undefined);
    const result = await run();
    if (!result.ok) {
      setError(describeFailure(result.failure));
      return;
    }
    closeModal(dialog.current);
    onDone?.(done);
  }
  const client = createLivesClient();
  const restrict = (input: CreateLiveRestrictionRequest, done: string) =>
    act(() => client.restrict(moderation.hostId, input), done);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(undefined);
          openModal(dialog.current);
        }}
        aria-haspopup="dialog"
        aria-label={`Модерация ${user.username}`}
        className="mr-1.5 font-semibold hover:underline"
      >
        {user.username}
      </button>
      <dialog
        ref={dialog}
        aria-label={`Действия с ${user.username}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeModal(dialog.current);
        }}
        className="fixed inset-0 m-auto w-[min(88vw,300px)] rounded-2xl border bg-ig-elevated p-0 text-foreground backdrop:bg-black/50"
      >
        <div role="menu" className="flex flex-col p-1 text-sm">
          <p className="px-3 py-2 text-xs text-muted-foreground">{user.username}</p>
          {mutes.map((mute) => (
            <button
              key={mute.label}
              type="button"
              role="menuitem"
              onClick={() =>
                void restrict(
                  { kind: "mute", userId: user.id, minutes: mute.minutes },
                  `${user.username}: ${mute.label.toLowerCase()}`,
                )
              }
              className="rounded-lg px-3 py-2 text-left hover:bg-secondary"
            >
              {mute.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void restrict({ kind: "ban", userId: user.id }, `${user.username} заблокирован(а)`)
            }
            className="rounded-lg px-3 py-2 text-left text-[#ff3040] hover:bg-secondary"
          >
            Заблокировать
          </button>
          {moderation.role === "host" && (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                void act(
                  () => client.addModerator(moderation.hostId, user.id),
                  `${user.username} теперь модератор`,
                )
              }
              className="rounded-lg px-3 py-2 text-left hover:bg-secondary"
            >
              Назначить модератором
            </button>
          )}
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}

// The host's and moderators' list of moderators and restrictions, with
// lifting. Moderators see the restrictions only.
export function ModerationPanel({ moderation }: { moderation: Moderation }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [moderators, setModerators] = useState<UserSummary[]>([]);
  const [restrictions, setRestrictions] = useState<LiveRestriction[]>([]);
  const [error, setError] = useState<string>();
  const client = createLivesClient();
  const host = moderation.role === "host";

  async function load() {
    const list = await client.restrictions(moderation.hostId);
    if (list.ok) setRestrictions(list.data.items);
    else setError(describeFailure(list.failure));
    if (!host) return;
    const team = await client.moderators(moderation.hostId);
    if (team.ok) setModerators(team.data.items);
  }
  async function lift(item: LiveRestriction) {
    const result = await client.unrestrict(moderation.hostId, item.user.id, item.kind);
    if (!result.ok) setError(describeFailure(result.failure));
    void load();
  }
  async function dismiss(user: UserSummary) {
    const result = await client.removeModerator(moderation.hostId, user.id);
    if (result.ok) setModerators(result.data.items);
    else setError(describeFailure(result.failure));
  }

  return (
    <>
      <button
        type="button"
        aria-label="Модерация"
        onClick={() => {
          setError(undefined);
          openModal(dialog.current);
          void load();
        }}
        className={roundButton}
      >
        <Shield size={20} />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="moderation-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeModal(dialog.current);
        }}
        className="fixed inset-0 m-auto w-[min(92vw,420px)] rounded-3xl border bg-ig-elevated p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto p-5">
          <header className="flex items-center justify-between">
            <h2 id="moderation-title" className="text-lg font-semibold">
              Модерация
            </h2>
            <button
              type="button"
              aria-label="Закрыть модерацию"
              onClick={() => closeModal(dialog.current)}
              className="rounded-full p-1.5 hover:bg-secondary"
            >
              <X size={20} />
            </button>
          </header>
          <p className="text-xs text-muted-foreground">
            Действует во всех ваших эфирах. Чтобы замутить или заблокировать, нажмите
            на имя в чате.
          </p>
          {host && (
            <section aria-label="Модераторы" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Модераторы</h3>
              {moderators.length === 0 && (
                <p className="text-xs text-muted-foreground">Модераторов пока нет.</p>
              )}
              {moderators.map((user) => (
                <Row key={user.id} user={user} note="модератор">
                  <button
                    type="button"
                    onClick={() => void dismiss(user)}
                    className="text-xs font-semibold text-ig-link"
                  >
                    Снять
                  </button>
                </Row>
              ))}
            </section>
          )}
          <section aria-label="Ограничения" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Ограничения</h3>
            {restrictions.length === 0 && (
              <p className="text-xs text-muted-foreground">Никто не ограничен.</p>
            )}
            {restrictions.map((item) => (
              <Row
                key={`${item.user.id}-${item.kind}`}
                user={item.user}
                note={
                  item.kind === "ban"
                    ? "заблокирован(а)"
                    : `мут ${muteTerm({ until: item.until })}`
                }
              >
                <button
                  type="button"
                  onClick={() => void lift(item)}
                  className="text-xs font-semibold text-ig-link"
                >
                  {item.kind === "ban" ? "Разблокировать" : "Снять мут"}
                </button>
              </Row>
            ))}
          </section>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}

function Row({
  user,
  note,
  children,
}: {
  user: UserSummary;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Avatar name={user.username} src={user.avatarUrl} size={28} />
      <span className="min-w-0 flex-1 truncate">
        <b>{user.username}</b> <span className="text-xs text-muted-foreground">· {note}</span>
      </span>
      {children}
    </div>
  );
}
