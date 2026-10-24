"use client";

import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

import { toggleTheme, useTheme } from "@/lib/theme";

// Light/dark switch in the shell; the icon shows the theme it switches to.
export function ThemeToggle({
  className,
  label,
}: {
  className?: string;
  label?: (next: string) => ReactNode;
}) {
  const theme = useTheme();
  const next = theme === "dark" ? "Светлый режим" : "Тёмный режим";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      aria-label={label ? undefined : next}
      className={className}
      onClick={toggleTheme}
    >
      <Icon aria-hidden className="size-6 shrink-0" />
      {label?.(next)}
    </button>
  );
}
