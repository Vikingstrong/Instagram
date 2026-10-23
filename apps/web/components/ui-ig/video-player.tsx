"use client";

import { forwardRef, useState, type VideoHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type VideoPlayerProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src" | "poster"> & {
  src: string;
  poster: string;
  label: string;
};

// Access-checked video from /api/v1/media/{id}/video. A plain <video>: the
// browser streams it with Range requests and the viewer's session cookie;
// nothing goes through a shared cache or optimizer. The poster is the
// post's image. A refused or broken file shows a short message instead.
export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  function VideoPlayer({ src, poster, label, className, onError, ...props }, ref) {
    const [broken, setBroken] = useState(false);
    if (broken)
      return (
        <div
          role="img"
          aria-label={label}
          className={cn(
            "flex aspect-video w-full items-center justify-center bg-black text-sm text-white/80",
            className,
          )}
        >
          Видео недоступно
        </div>
      );
    return (
      <video
        ref={ref}
        src={src}
        poster={poster}
        aria-label={label}
        playsInline
        preload="metadata"
        onError={(event) => {
          setBroken(true);
          onError?.(event);
        }}
        className={className}
        {...props}
      />
    );
  },
);
