"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Pause, Play } from "lucide-react";

const BARS = 32;

// Stable pseudo-random waveform per recording, like the Instagram voice bubble.
function waveform(seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Array.from({ length: BARS }, (_, index) => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
    const envelope = Math.sin(((index + 1) / (BARS + 1)) * Math.PI);
    return 0.25 + 0.75 * envelope * (0.35 + (hash % 1000) / 1540);
  });
}

function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Pause and release a private media request on navigation/logout and when a
// preview is replaced. Removing a playing <audio> alone need not stop playback.
export function PrivateAudio({
  src,
  opusUrl,
  label,
  mine = false,
  durationMs,
}: {
  src: string;
  opusUrl?: string;
  label: string;
  mine?: boolean;
  durationMs?: number;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [metaDuration, setMetaDuration] = useState(0);
  const bars = useMemo(() => waveform(src), [src]);
  // MediaRecorder WebM often reports Infinity, so the server duration wins.
  const duration = durationMs ? durationMs / 1000 : metaDuration;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
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
  function toggle() {
    const audio = ref.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = ref.current;
    if (!audio || !duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    audio.currentTime = ratio * duration;
    setCurrent(audio.currentTime);
  }

  // A new element keeps effect cleanup bound to the old playback when its
  // sources change, rather than clearing the replacement's source attributes.
  return (
    <div
      className={`flex w-64 max-w-full items-center gap-3 rounded-full py-2 pr-4 pl-2 ${mine ? "bg-ig-blue text-white" : "bg-secondary text-foreground"}`}
    >
      <button
        type="button"
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        onClick={toggle}
        className={`grid size-9 shrink-0 place-items-center rounded-full transition active:scale-90 ${mine ? "bg-white/20 hover:bg-white/30" : "bg-foreground/10 hover:bg-foreground/15"}`}
      >
        {playing ? (
          <Pause aria-hidden className="size-4 fill-current" />
        ) : (
          <Play aria-hidden className="ml-0.5 size-4 fill-current" />
        )}
      </button>
      <div
        aria-hidden
        onClick={seek}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
      >
        {bars.map((height, index) => (
          <span
            key={index}
            style={{ height: `${Math.round(height * 100)}%` }}
            className={`w-[3px] shrink-0 grow rounded-full bg-current transition-opacity duration-150 ${(index + 0.5) / BARS <= progress ? "opacity-100" : "opacity-40"}`}
          />
        ))}
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums">
        {clock(playing || current > 0 ? current : duration)}
      </span>
      <audio
        key={`${src}:${opusUrl ?? ""}`}
        ref={ref}
        data-voice
        preload="metadata"
        aria-label={label}
        className="hidden"
        onPlay={(event) => {
          // Only one voice message plays at a time, as in Instagram.
          document
            .querySelectorAll<HTMLAudioElement>("audio[data-voice]")
            .forEach((other) => other !== event.currentTarget && other.pause());
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setMetaDuration(value);
        }}
        {...(!opusUrl && { src })}
      >
        {opusUrl && (
          <>
            <source src={opusUrl} type="audio/webm" />
            <source src={src} type="audio/mp4" />
          </>
        )}
      </audio>
    </div>
  );
}
