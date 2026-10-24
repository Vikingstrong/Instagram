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

// A wavy front (clip-path polygon) sweeping diagonally from the bottom-right
// corner to the top-left. The front is the line x + y = level with a wave
// along it; every frame has the same points, so the browser morphs them.
function waveFrames(): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let frame = 0; frame <= 30; frame++) {
    const t = frame / 30;
    const level = 215 - t * 240; // past the bottom-right corner → past the top-left
    const points: string[] = [];
    for (let u = -300; u <= 300; u += 10) {
      const wave =
        6 * Math.sin((u / 100) * 2 * Math.PI + t * 6 * Math.PI) +
        2.5 * Math.sin((u / 100) * 5 * Math.PI - t * 4 * Math.PI);
      const x = (level + u) / 2 + wave;
      const y = (level - u) / 2 + wave;
      points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
    frames.push({ clipPath: `polygon(${points.join(", ")}, 500% 500%)` });
  }
  return frames;
}

// Switches the theme with a wave of the new palette washing over the page.
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
  root.dataset.themeWave = "";
  const transition = document.startViewTransition(() => applyTheme(next));
  void transition.ready.then(() => {
    root.animate(waveFrames(), {
      duration: 1200,
      easing: "cubic-bezier(0.45, 0, 0.25, 1)",
      pseudoElement: "::view-transition-new(root)",
    });
  });
  void transition.finished.finally(() => {
    delete root.dataset.themeWave;
  });
}
