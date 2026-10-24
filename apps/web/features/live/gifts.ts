import {
  isFullscreenGift,
  liveGiftCatalog,
  type LiveGiftKey,
} from "@instagram/contracts";

// Names and pictures of the FR-14 gifts; prices come from the shared
// catalog, which the API enforces.
const names: Record<LiveGiftKey, string> = {
  rose: "Роза",
  heart: "Сердечко",
  glasses: "Очки",
  instagram: "Логотип Instagram",
  pumpkin: "Хэллоуинская тыква",
  cat: "Кошка",
};

export const gifts = liveGiftCatalog.map((gift) => ({
  ...gift,
  name: names[gift.key],
  image: gift.key === "cat" ? "/gifts/cat.gif" : `/gifts/${gift.key}.png`,
  // The cat is pixel art: it is scaled without smoothing.
  pixelated: gift.key === "cat",
  fullscreen: isFullscreenGift(gift.key),
}));
export type GiftInfo = (typeof gifts)[number];
export const giftInfo = (key: LiveGiftKey) => gifts.find((gift) => gift.key === key)!;

// 1 монета, 3 монеты, 5 монет, 21 монета; after "за" (accusative): 1 монету.
// Balances are decimal strings of any size, so the form is read from the
// last digits.
export function coins(count: number | string, accusative = false) {
  const digits = String(count);
  const tens = Number(digits.slice(-2));
  const ones = Number(digits.slice(-1));
  const form =
    tens >= 11 && tens <= 14
      ? "монет"
      : ones === 1
        ? accusative
          ? "монету"
          : "монета"
        : ones >= 2 && ones <= 4
          ? "монеты"
          : "монет";
  return `${new Intl.NumberFormat("ru-RU").format(BigInt(digits))} ${form}`;
}
