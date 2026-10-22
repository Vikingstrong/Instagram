import { InstagramGlyphIcon } from "@/components/icons/ig-icons";

export const authInputClass = "mt-2 h-14 w-full rounded-2xl border border-white/20 bg-white/[0.025] px-4 text-base text-white outline-none transition focus:border-[#708dff] focus:ring-4 focus:ring-[#708dff]/10 placeholder:text-[#969ba3] disabled:opacity-50";
export const authButtonClass = "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-full bg-[#5264fa] px-5 py-3 font-semibold text-white transition hover:bg-[#6979ff] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8e9aff] disabled:cursor-wait disabled:opacity-50";

export function AuthBrand() {
  return <span className="inline-flex items-center gap-3" aria-label="Instagram">
    <span className="flex size-11 items-center justify-center rounded-[14px] bg-linear-to-tr from-[#ffd76a] via-[#f13191] to-[#7627ff] text-white"><InstagramGlyphIcon className="size-7" /></span>
    <span className="font-wordmark text-4xl leading-none">Instagram</span>
  </span>;
}

export { AuthArtwork } from "./auth-artwork";
