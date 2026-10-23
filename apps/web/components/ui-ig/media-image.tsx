import type { ImgHTMLAttributes } from "react";

// Access-checked image from /api/v1/media. Deliberately a plain <img>, not
// next/image: the optimizer would fetch the file without the viewer's session
// and keep a shared cached copy, which private posts must never get.
export function MediaImage({
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} decoding="async" {...props} />;
}
