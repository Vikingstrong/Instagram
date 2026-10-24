import Image from "next/image";

import { HeartIcon } from "@/components/icons/ig-icons";

// Story-style cover for the auth screens: three tilted story cards, reply bars
// and stickers. Photos are bundled in public/auth-art (no remote requests),
// free under the Unsplash License (https://unsplash.com/license):
// - story-left:   MOHAMMAD AL JANNAT RAKIN, unsplash.com/photos/WgKh5lJG0k0
// - story-center: Ninthgrid, unsplash.com/photos/rjnIYeC6rmA
// - story-right:  Vitaly Gariev, unsplash.com/photos/9a4oqnrKj9s
// - avatar:       Timothy Dykes, unsplash.com/photos/yd4ubMUNTG0

function StoryCard({
  position,
  src,
  progress,
  sizes,
}: {
  position: "left" | "center" | "right";
  src: string;
  progress: number;
  sizes: string;
}) {
  return (
    <div className={`auth-card auth-card-${position}`}>
      <Image src={src} alt="" fill sizes={sizes} className="object-cover" />
      <div className="auth-story-bars">
        <span><i style={{ width: `${progress}%` }} /></span>
        <span />
      </div>
      <div className="auth-story-reply">
        <span className="auth-story-input" />
        <HeartIcon className="size-5" />
      </div>
    </div>
  );
}

export function AuthArtwork() {
  return (
    <div className="auth-art" aria-hidden="true">
      {/* Soft glows in the Instagram logo colours, behind the cards. */}
      <span className="auth-glow auth-glow-purple" />
      <span className="auth-glow auth-glow-red" />
      <span className="auth-glow auth-glow-yellow" />
      <span className="auth-glow auth-glow-orange" />
      <StoryCard position="left" src="/auth-art/story-left.jpg" progress={70} sizes="168px" />
      <StoryCard position="right" src="/auth-art/story-right.jpg" progress={35} sizes="168px" />
      <StoryCard position="center" src="/auth-art/story-center.jpg" progress={55} sizes="216px" />

      <svg className="auth-sticker-heart" viewBox="0 0 24 24">
        <defs>
          <linearGradient id="ig-art-heart" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff7a59" />
            <stop offset="1" stopColor="#e1306c" />
          </linearGradient>
        </defs>
        <path d="M12 21.2S2.6 15.6 2.6 9.2A5 5 0 0 1 7.6 4.2c1.9 0 3.5 1 4.4 2.6.9-1.6 2.5-2.6 4.4-2.6a5 5 0 0 1 5 5c0 6.4-9.4 12-9.4 12Z" fill="url(#ig-art-heart)" />
      </svg>
      <span className="auth-sticker-star">
        <svg viewBox="0 0 24 24"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7Z" fill="#fff" /></svg>
        <svg viewBox="0 0 24 24" className="auth-sticker-check"><path d="m6 12 4 4 8-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="auth-sticker-avatar">
        <Image src="/auth-art/avatar.jpg" alt="" width={66} height={66} />
      </span>
    </div>
  );
}
