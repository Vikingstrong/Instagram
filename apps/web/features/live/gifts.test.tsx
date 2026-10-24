import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveGift } from "@instagram/contracts";

import { GiftEffects } from "./gift-effects";
import { GiftPanel } from "./gift-panel";
import { coins, gifts } from "./gifts";

const api = vi.hoisted(() => ({
  gifts: vi.fn(),
  sendGift: vi.fn(),
  wallet: vi.fn(),
}));
vi.mock("@/lib/api/lives", () => ({
  createLivesClient: () => ({ gifts: api.gifts, sendGift: api.sendGift }),
}));
vi.mock("@/lib/api/coins", () => ({
  createCoinsClient: () => ({ wallet: api.wallet }),
}));

const liveId = "00000000-0000-4000-8000-0000000000aa";
const sender = {
  id: "00000000-0000-4000-8000-000000000002",
  username: "viewer",
  displayName: "",
  avatarUrl: null,
  isPrivate: false,
};
const gift = (n: number, giftKey: LiveGift["giftKey"]): LiveGift => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  giftKey,
  price: gifts.find((item) => item.key === giftKey)!.price,
  sender,
  createdAt: `2026-10-24T10:00:0${n}.000Z`,
});
const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });

beforeEach(() => {
  api.gifts.mockReset();
  api.sendGift.mockReset();
  api.wallet.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("gift catalog", () => {
  it("names prices in Russian and plays only gifts above 10 coins full screen", () => {
    expect(gifts.map((item) => [item.name, coins(item.price)])).toEqual([
      ["Роза", "1 монета"],
      ["Сердечко", "3 монеты"],
      ["Очки", "5 монет"],
      ["Логотип Instagram", "10 монет"],
      ["Хэллоуинская тыква", "50 монет"],
      ["Кошка", "100 монет"],
    ]);
    expect(gifts.filter((item) => item.fullscreen).map((item) => item.key)).toEqual([
      "pumpkin",
      "cat",
    ]);
    expect(gifts.find((item) => item.key === "cat")!.image).toBe("/gifts/cat.gif");
    // Intl groups thousands with a narrow no-break space.
    expect([coins(1, true), coins(21, true), coins(3, true)]).toEqual(["1 монету", "21 монету", "3 монеты"]);
    expect([coins(11), coins(21), coins("1000000").replace(/\s/gu, " ")]).toEqual([
      "11 монет",
      "21 монета",
      "1 000 000 монет",
    ]);
  });
});

describe("gift effects", () => {
  it("skips earlier gifts, shows small ones as a line and big ones full screen once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.gifts
      .mockResolvedValueOnce(ok({ items: [gift(1, "cat")], next: "c1" }))
      .mockResolvedValueOnce(ok({ items: [gift(2, "rose"), gift(3, "pumpkin")], next: "c3" }))
      .mockResolvedValue(ok({ items: [], next: "c3" }));
    const { rerender } = render(<GiftEffects liveId={liveId} open />);
    await waitFor(() => expect(api.gifts).toHaveBeenCalledWith(liveId, undefined));
    // History from before the page opened plays nothing.
    expect(screen.queryByText(/дарит/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(api.gifts).toHaveBeenLastCalledWith(liveId, "c1");
    expect(await screen.findByText("«Роза»", { exact: false })).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "viewer дарит «Хэллоуинская тыква» за 50 монет" }),
    ).toBeTruthy();
    // The sender's own gift, already shown from the feed, does not repeat.
    rerender(<GiftEffects liveId={liveId} open own={gift(3, "pumpkin")} />);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<GiftEffects liveId={liveId} open own={gift(4, "cat")} />);
    expect(screen.getByRole("status", { name: "viewer дарит «Кошка» за 100 монет" })).toBeTruthy();
  });
});

describe("gift panel", () => {
  it("sends a gift, shows the new balance and keeps the intent id for a retry", async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    api.wallet.mockResolvedValue(ok({ wallet: { balance: "4" } }));
    api.sendGift
      .mockResolvedValueOnce({ ok: false, failure: { kind: "network" } })
      .mockResolvedValueOnce(ok({ gift: gift(5, "heart"), balance: "1" }))
      .mockResolvedValueOnce({
        ok: false,
        failure: {
          kind: "api",
          status: 409,
          error: { code: "COINS_INSUFFICIENT_BALANCE", message: "x", requestId: "r" },
        },
      });
    render(<GiftPanel liveId={liveId} onSent={onSent} />);
    await user.click(screen.getByRole("button", { name: "Подарки" }));
    expect(await screen.findByText("Баланс: 4 монеты")).toBeTruthy();

    const heart = screen.getByRole("button", { name: "Подарить «Сердечко» за 3 монеты" });
    await user.click(heart);
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    await user.click(heart);
    const [[, first], [, second]] = api.sendGift.mock.calls;
    expect(second).toEqual(first);
    expect(first.giftKey).toBe("heart");
    expect(await screen.findByText("Баланс: 1 монета")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Отправлено: «Сердечко»");
    expect(onSent).toHaveBeenCalledWith(gift(5, "heart"));

    await user.click(screen.getByRole("button", { name: "Подарить «Очки» за 5 монет" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Недостаточно монет");
    expect(screen.getByRole("link", { name: "Получить монеты" }).getAttribute("href")).toBe(
      "/coins",
    );
    // A new intent after a success.
    expect(api.sendGift.mock.calls[2]![1].id).not.toBe(first.id);
  });
});
