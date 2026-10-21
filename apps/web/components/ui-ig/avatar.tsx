import { cn } from "@/lib/utils";

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
  storyRing?: boolean;
  className?: string;
};

// Placeholder avatar: initials on a gradient until real media arrives (stage 4).
export function Avatar({ name, size, storyRing, className }: AvatarProps) {
  const face = (
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

// Grey silhouette shown for a user without a photo.
export function DefaultAvatar({
  size,
  active,
  className,
}: {
  size: number;
  active?: boolean;
  className?: string;
}) {
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
