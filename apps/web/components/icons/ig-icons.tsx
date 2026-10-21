import type { ReactNode, SVGProps } from "react";

import { cn } from "@/lib/utils";

// Hand-drawn 24×24 icon set in the Instagram style. `active` switches to the
// filled/bold variant used for the current navigation item.
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  active?: boolean;
};

function Svg({
  active: _active,
  className,
  strokeWidth = 2,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  void _active; // variant is resolved by each icon, not passed to <svg>
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-6 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function InstagramGlyphIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.3" />
      <circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function HomeIcon({ active, ...props }: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M3 10.4 12 2.8l9 7.6V21h-6.2v-5.6a2.8 2.8 0 0 0-5.6 0V21H3Z"
        fill={active ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function ReelsIcon({ active, ...props }: IconProps) {
  return (
    <Svg {...props}>
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5"
        fill={active ? "currentColor" : "none"}
      />
      <path
        d="M10 8.6v6.8l5.6-3.4Z"
        fill={active ? "var(--background)" : "none"}
        stroke={active ? "var(--background)" : "currentColor"}
      />
    </Svg>
  );
}

export function DirectIcon({ active, ...props }: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M21.5 2.5 2.5 9.4l7.7 3.4 3.4 7.7Z"
        fill={active ? "currentColor" : "none"}
      />
      <path
        d="m10.2 12.8 11.3-10.3"
        stroke={active ? "var(--background)" : "currentColor"}
      />
    </Svg>
  );
}

export function SearchIcon({ active, ...props }: IconProps) {
  return (
    <Svg strokeWidth={active ? 3 : 2} {...props}>
      <circle cx="10.5" cy="10.5" r="7.5" />
      <path d="m16.2 16.2 5.3 5.3" />
    </Svg>
  );
}

export function HeartIcon({ active, ...props }: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 20.3S3 15 3 8.9a4.7 4.7 0 0 1 4.7-4.7c1.9 0 3.4 1 4.3 2.6.9-1.6 2.4-2.6 4.3-2.6A4.7 4.7 0 0 1 21 8.9c0 6.1-9 11.4-9 11.4Z"
        fill={active ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function CreateIcon({ active, ...props }: IconProps) {
  return (
    <Svg strokeWidth={active ? 3 : 2} {...props}>
      <path d="M12 4v16M4 12h16" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5h18M3 12h18M3 19h18" />
    </Svg>
  );
}

export function AppsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8.5" y="2.5" width="7" height="7" rx="1.5" />
      <rect x="2.5" y="14.5" width="7" height="7" rx="1.5" />
      <rect x="14.5" y="14.5" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.7 16.7A9.6 9.6 0 1 0 17.3 20l4.2 1.5Z" />
    </Svg>
  );
}

export function BookmarkIcon({ active, ...props }: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M19 21 12 14.6 5 21V3h14Z"
        fill={active ? "currentColor" : "none"}
      />
    </Svg>
  );
}

export function MoreHorizontalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

// Scalloped blue badge: a centre disc plus eight overlapping lobes.
export function VerifiedBadge({ className }: { className?: string }) {
  const lobes = [
    [7.6, 0],
    [5.37, 5.37],
    [0, 7.6],
    [-5.37, 5.37],
    [-7.6, 0],
    [-5.37, -5.37],
    [0, -7.6],
    [5.37, -5.37],
  ];
  return (
    <svg
      viewBox="-12 -12 24 24"
      aria-label="Подтверждённый"
      role="img"
      className={cn("size-3 shrink-0", className)}
    >
      <g fill="#0095f6">
        <circle r="8.4" />
        {lobes.map(([cx, cy]) => (
          <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="3.6" />
        ))}
      </g>
      <path
        d="m-4.2 0.3 2.7 2.7 5.6-5.6"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
