"use client";

import Link from "next/link";
import { ArrowUpRight, CirclePlus, Film, ImagePlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CreateIcon } from "@/components/icons/ig-icons";
import { openModal } from "@/components/ui-ig/confirm-dialog";

const formats = [
  {
    title: "Публикация",
    description: "Фото или видео, которое останется в профиле",
    href: "/create",
    icon: ImagePlus,
    tone: "from-blue-500/20 to-cyan-400/10 text-blue-400",
    detail: "В ленту и профиль",
  },
  {
    title: "Reels",
    description: "Поделитесь моментом в коротком видео",
    href: "/create/reel",
    icon: Film,
    tone: "from-violet-500/20 to-fuchsia-400/10 text-violet-400",
    detail: "Видео до 90 секунд",
  },
  {
    title: "История",
    description: "Фото или видео для тех, кто следит за вами",
    href: "/stories/create",
    icon: CirclePlus,
    tone: "from-orange-400/20 to-rose-500/10 text-orange-400",
    detail: "Исчезнет через 24 часа",
  },
];

// Native modal stays above the collapsed desktop rail and traps keyboard focus.
export function CreateMenu({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dialogId = useId();
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-auth-required
        aria-label={children ? undefined : "Создать"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        className={className}
        onClick={() => setOpen(true)}
      >
        <CreateIcon />
        {children}
      </button>
      {open && (
        <CreationDialog
          id={dialogId}
          titleId={titleId}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

function CreationDialog({
  id,
  titleId,
  onClose,
}: {
  id: string;
  titleId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  function dismiss() {
    // Close the native modal before focusing its trigger: the background is
    // inert while showModal is active, so focusing it earlier has no effect.
    if (typeof dialog.current?.close === "function") dialog.current.close();
    onClose();
  }
  useEffect(() => {
    const node = dialog.current;
    openModal(node);
    return () => {
      if (node?.open && typeof node.close === "function") node.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      id={id}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="relative overflow-hidden px-6 pt-8 pb-6 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-12 size-64 rounded-full bg-violet-500/10 blur-3xl"
        />
        <div className="relative">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Поделитесь своим
          </p>
          <h2
            id={titleId}
            className="pr-8 text-3xl font-semibold tracking-tight"
          >
            Что создадим?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Выберите формат для вашей идеи.
          </p>
        </div>
        <button
          type="button"
          aria-label="Закрыть выбор формата"
          onClick={dismiss}
          className="absolute top-5 right-5 grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="grid gap-3 px-4 pb-4 sm:px-6 sm:pb-6">
        {formats.map(
          ({ title, description, href, icon: Icon, tone, detail }) => (
            <Link
              key={href}
              href={href}
              aria-label={title}
              onClick={dismiss}
              className="group flex items-center gap-4 rounded-2xl border bg-secondary/25 p-4 transition-colors hover:border-foreground/25 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ig-link sm:p-5"
            >
              <span
                className={`grid size-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br ${tone}`}
              >
                <Icon aria-hidden className="size-7" strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {description}
                </span>
                <span className="mt-2 block text-[11px] font-medium text-muted-foreground">
                  {detail}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
              />
            </Link>
          ),
        )}
      </div>
    </dialog>
  );
}
