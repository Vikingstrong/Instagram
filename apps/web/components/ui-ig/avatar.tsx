import { cn } from "@/lib/utils";

import { MediaImage } from "./media-image";

const gradients = [
  "from-amber-400 to-rose-500",
  "from-sky-400 to-indigo-600",
  "from-emerald-400 to-teal-700",
  "from-fuchsia-400 to-purple-700",
  "from-orange-400 to-red-600",
  "from-cyan-400 to-blue-700",
];

function pickGradient(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

type AvatarProps = {
  name: string;
  size: number;
  // Access-checked avatar image; initials on a gradient when there is none.
  src?: string | null;
  storyRing?: boolean;
  className?: string;
};

export function Avatar({ name, size, src, storyRing, className }: AvatarProps) {
  const face = src ? (
    <AvatarPhoto src={src} size={size} className={cn(!storyRing && className)} />
  ) : (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-linear-to-br font-semibold text-white select-none",
        pickGradient(name),
        !storyRing && className,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );

  if (!storyRing) {
    return face;
  }

  return (
    <span
      className={cn(
        "flex shrink-0 rounded-full bg-linear-to-tr from-[#feda75] via-[#d62976] to-[#962fbf] p-[2px]",
        className,
      )}
    >
      <span className="rounded-full bg-background p-[2px]">{face}</span>
    </span>
  );
}

function AvatarPhoto({
  src,
  size,
  className,
}: {
  src: string;
  size: number;
  className?: string;
}) {
  return (
    <MediaImage
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("shrink-0 rounded-full bg-secondary object-cover", className)}
    />
  );
}

// The user's photo, or a grey silhouette for a user without one.
export function DefaultAvatar({
  size,
  src,
  active,
  className,
}: {
  size: number;
  src?: string | null;
  active?: boolean;
  className?: string;
}) {
  if (src)
    return (
      <AvatarPhoto
        src={src}
        size={size}
        className={cn(
          active && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
          className,
        )}
      />
    );
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dbdbdb]",
        active && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-full" fill="#8e8e8e">
        <circle cx="12" cy="9.3" r="4.3" />
        <path d="M3.6 21.6a8.4 8.4 0 0 1 16.8 0Z" />
      </svg>
    </span>
  );
}
