"use client";

import { useEffect, useRef } from "react";

// Pause and release a private media request on navigation/logout and when a
// preview is replaced. Removing a playing <audio> alone need not stop playback.
export function PrivateAudio({
  src,
  opusUrl,
  label,
}: {
  src: string;
  opusUrl?: string;
  label: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    // React Strict Mode runs setup → cleanup → setup on the same DOM node.
    // Restore sources removed by cleanup before resuming metadata loading.
    let changed = false;
    if (opusUrl) {
      const sources = audio.querySelectorAll("source");
      for (const [index, url] of [opusUrl, src].entries()) {
        const source = sources[index];
        if (source && source.getAttribute("src") !== url) {
          source.setAttribute("src", url);
          changed = true;
        }
      }
    } else if (audio.getAttribute("src") !== src) {
      audio.setAttribute("src", src);
      changed = true;
    }
    if (changed) audio.load();
    return () => {
      if (!audio) return;
      const requested = audio.networkState !== HTMLMediaElement.NETWORK_EMPTY;
      if (!audio.paused) audio.pause();
      audio.removeAttribute("src");
      audio
        .querySelectorAll("source")
        .forEach((source) => source.removeAttribute("src"));
      if (requested) audio.load();
    };
  }, [src, opusUrl]);
  // A new element keeps effect cleanup bound to the old playback when its
  // sources change, rather than clearing the replacement's source attributes.
  return (
    <audio
      key={`${src}:${opusUrl ?? ""}`}
      ref={ref}
      controls
      preload="metadata"
      aria-label={label}
      className="max-w-full"
      {...(!opusUrl && { src })}
    >
      {opusUrl && (
        <>
          <source src={opusUrl} type="audio/webm" />
          <source src={src} type="audio/mp4" />
        </>
      )}
    </audio>
  );
}
