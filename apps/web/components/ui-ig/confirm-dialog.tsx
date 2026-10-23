"use client";

import { useEffect, useRef, type ReactNode } from "react";

// jsdom has no showModal; fall back to a plain open dialog there.
export function openModal(node: HTMLDialogElement | null) {
  if (!node || node.open) return;
  if (typeof node.showModal === "function") node.showModal();
  else node.setAttribute("open", "");
}

// Instagram-style confirmation card: optional picture, title, text and a
// stacked destructive action above "Отмена". Escape and backdrop cancel.
export function ConfirmDialog({
  title,
  description,
  media,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: ReactNode;
  media?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => openModal(dialog.current), []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !busy) onCancel();
      }}
      className="fixed inset-0 z-80 m-auto w-[calc(100%-2rem)] max-w-100 overflow-hidden rounded-xl bg-ig-elevated p-0 text-foreground shadow-2xl backdrop:bg-black/65"
    >
      <div className="flex flex-col items-center gap-3 px-8 pt-8 pb-6 text-center">
        {media}
        <h2 id="confirm-title" className="text-xl font-normal">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col border-t text-sm">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="min-h-12 border-b font-bold text-destructive transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {busy ? "Подождите…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-12 transition-colors hover:bg-secondary disabled:opacity-60"
        >
          Отмена
        </button>
      </div>
    </dialog>
  );
}
