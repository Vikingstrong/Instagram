"use client";

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-script";

export type Theme = "light" | "dark";

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark");
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode: the theme still switches for this visit.
  }
}

// Switches the theme with a page-turn: going dark turns the page forward
// (the old page lifts off to the left), going light turns it back.
export function toggleTheme() {
  const next: Theme = readTheme() === "dark" ? "light" : "dark";
  const root = document.documentElement;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (typeof document.startViewTransition !== "function" || reduceMotion) {
    applyTheme(next);
    return;
  }
  root.dataset.themeFlip = next === "dark" ? "forward" : "back";
  const transition = document.startViewTransition(() => applyTheme(next));
  void transition.finished.finally(() => {
    delete root.dataset.themeFlip;
  });
}
