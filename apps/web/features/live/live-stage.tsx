"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Eye } from "lucide-react";
import type { UserSummary } from "@instagram/contracts";

import { Avatar } from "@/components/ui-ig/avatar";
import { cn } from "@/lib/utils";

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md bg-linear-to-r from-[#d300c5] to-[#ff0069] px-1.5 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap text-white uppercase",
        className,
      )}
    >
      В эфире
    </span>
  );
}

// A <video> bound to a MediaStream. Live media has no src URL.
export function StreamVideo({
  stream,
  muted,
  mirrored,
  label,
  className,
  onBlocked,
}: {
  stream?: MediaStream;
  muted?: boolean;
  mirrored?: boolean;
  label: string;
  className?: string;
  // Autoplay with sound was refused: the caller offers a button.
  onBlocked?: () => void;
}) {
  const node = useRef<HTMLVideoElement>(null);
  const blocked = useRef(onBlocked);
  useEffect(() => {
    blocked.current = onBlocked;
  });
  useEffect(() => {
    const video = node.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  // Sound is a property here (React does not keep the muted attribute in
  // sync); a paused video is started again after each change.
  useEffect(() => {
    const video = node.current;
    if (!video || !stream) return;
    video.muted = Boolean(muted);
    if (video.paused) void video.play().catch(() => blocked.current?.());
  }, [stream, muted]);
  return (
    <video
      ref={node}
      autoPlay
      playsInline
      aria-label={label}
      className={cn(
        "absolute inset-0 size-full object-cover",
        mirrored && "-scale-x-100",
        !stream && "opacity-0",
        className,
      )}
    />
  );
}

// Vertical live frame: video with the host, the badge and the viewer count
// on top, actions at the bottom; the chat sits beside it (below on phones).
export function LiveStage({
  host,
  viewerCount,
  onAir,
  video,
  status,
  actions,
  overlay,
  chat,
}: {
  host: UserSummary;
  viewerCount?: number;
  onAir: boolean;
  video: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  // Above the video, under the actions: gift lines.
  overlay?: ReactNode;
  chat?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-stretch justify-center gap-4 p-0 md:flex-row md:items-center md:p-6">
      <section
        aria-label="Эфир"
        className="relative mx-auto aspect-[9/16] h-[min(54dvh,760px)] max-w-full overflow-hidden bg-[radial-gradient(ellipse_at_top,#3b2f63_0%,#161827_55%,#0b0c14_100%)] text-white md:h-[min(86dvh,820px)] md:rounded-2xl"
      >
        {video}
        <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-linear-to-b from-black/60 to-transparent p-3">
          <Avatar name={host.username} src={host.avatarUrl} size={32} />
          <span className="min-w-0 truncate text-sm font-semibold">{host.username}</span>
          {onAir && <LiveBadge />}
          {onAir && viewerCount !== undefined && (
            <span
              aria-label={`Зрителей: ${viewerCount}`}
              className="flex shrink-0 items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-xs"
            >
              <Eye size={13} aria-hidden />
              {viewerCount}
            </span>
          )}
        </header>
        {overlay}
        {status && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {status}
          </div>
        )}
        {actions && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-3 bg-linear-to-t from-black/60 to-transparent p-4">
            {actions}
          </div>
        )}
      </section>
      {chat}
    </div>
  );
}

export const roundButton =
  "flex size-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 disabled:opacity-50";
