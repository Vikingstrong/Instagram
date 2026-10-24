"use client";

import Link from "next/link";
import { CirclePlus, Clapperboard, Images, Radio } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { CreateIcon } from "@/components/icons/ig-icons";

const formats = [
  { title: "Публикация", href: "/create", icon: Images },
  { title: "Reels", href: "/create/reel", icon: Clapperboard },
  { title: "История", href: "/stories/create", icon: CirclePlus },
  { title: "Прямой эфир", href: "/live", icon: Radio },
];

const itemClass =
  "flex w-full items-center justify-between gap-3 px-4 py-3.5 text-[15px] transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none";

// Like Instagram: a small dropdown next to "Создать" in the desktop rail
// (when a label is passed) and a bottom sheet from the mobile "+" button.
// Closes on Escape, outside clicks and choosing a format.
export function CreateMenu({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const sheet = !children;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !menu.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function toggle() {
    if (!open && !sheet && trigger.current) {
      const box = trigger.current.getBoundingClientRect();
      setAnchor({ left: box.left, top: box.bottom + 4 });
    }
    setOpen((value) => !value);
  }

  const items = formats.map(({ title, href, icon: Icon }) => (
    <Link
      key={href}
      role="menuitem"
      href={href}
      onClick={() => close(false)}
      className={itemClass}
    >
      {title}
      <Icon aria-hidden className="size-6 shrink-0" strokeWidth={1.75} />
    </Link>
  ));

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-auth-required
        aria-label={children ? undefined : "Создать"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={className}
        onClick={toggle}
      >
        <CreateIcon />
        {children}
      </button>
      {open && sheet && (
        <div className="fixed inset-0 z-70 bg-black/60 animate-in fade-in duration-200">
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="Создать"
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-ig-elevated pb-[max(env(safe-area-inset-bottom),12px)] animate-in slide-in-from-bottom duration-300"
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/40" />
            <p className="border-b py-3 text-center text-base font-semibold">
              Создать
            </p>
            <div className="divide-y">{items}</div>
          </div>
        </div>
      )}
      {open && !sheet && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Создать"
          style={anchor}
          className="fixed z-60 w-60 overflow-hidden rounded-2xl border bg-ig-elevated py-2 shadow-[0_4px_24px_rgb(0_0_0/0.35)] animate-in fade-in zoom-in-95 duration-150"
        >
          {items}
        </div>
      )}
    </>
  );
}
