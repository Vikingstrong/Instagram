import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoinWalletView } from "./coin-wallet";
import { MoreMenu } from "@/components/shell/more-menu";

const identity = vi.hoisted(() => ({
  id: "00000000-0000-4000-8000-000000000001",
  checking: false,
  guest: false,
}));
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () =>
    identity.guest
      ? null
      : {
          id: identity.id,
          username: "owner",
          email: "owner@example.test",
          emailVerified: true,
        },
  useHomeChecking: () => identity.checking,
}));
const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wallet = (claimed = false, balance = "0") => ({
  balance,
  serverTime: "2026-10-24T10:00:00.000Z",
  dailyReward: {
    claimed,
    amount: "100",
    timeZone: "Asia/Dushanbe",
    nextClaimAt: "2026-10-24T19:00:00.000Z",
  },
});
const transaction = (n = 1) => ({
  id: uuid(n),
  kind: "daily_reward",
  amount: "100",
  balanceAfter: "100",
  createdAt: "2026-10-24T10:00:00.000Z",
  counterparty: null,
  gift: null,
});
function api(
  handler?: (
    url: URL,
    init: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/v1/auth/csrf")
      return Response.json({ csrfToken });
    const response = handler?.(url, init);
    if (response) return response;
    if (url.pathname.endsWith("/wallet"))
      return Response.json({ wallet: wallet() });
    if (url.pathname.endsWith("/transactions"))
      return Response.json({ items: [], nextCursor: null });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  identity.id = uuid(1);
  identity.checking = false;
  identity.guest = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Coin wallet", () => {
  it("offers sign-in to a guest without requesting wallet data", () => {
    identity.guest = true;
    const fetch = api();
    render(<CoinWalletView />);
    expect(
      screen.getByRole("link", { name: "Войти" }).getAttribute("href"),
    ).toBe("/auth/login");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows a real zero balance and never claims automatically; button uses CSRF and disables after success", async () => {
    let claimed = false;
    const fetch = api((url, init) => {
      if (url.pathname.endsWith("/daily-claim")) {
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({});
        expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe(
          csrfToken,
        );
        claimed = true;
        return Response.json({
          credited: true,
          wallet: wallet(true, "100"),
          transaction: transaction(),
        });
      }
      if (url.pathname.endsWith("/transactions"))
        return Response.json({
          items: claimed ? [transaction()] : [],
          nextCursor: null,
        });
      return undefined;
    });
    render(<CoinWalletView />);
    await screen.findByLabelText("0 монет");
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/daily-claim"))).toBe(
      false,
    );
    expect(screen.getByRole("heading", { name: "Монеты" })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Получить 100 монет" }),
    );
    await screen.findByLabelText("100 монет");
    expect(
      (
        screen.getByRole("button", {
          name: "Получено сегодня",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Начислено 100 монет.")).toBeTruthy();
    expect(
      screen.getByText(/Снова доступно 25 октября.*00:00 по Душанбе/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("region", { name: "История операций" }),
        ).getByText("Ежедневный бонус"),
      ).toBeTruthy(),
    );
  });

  it("keeps the old balance after a lost response and safely retries an already credited bonus", async () => {
    let calls = 0;
    api((url) => {
      if (!url.pathname.endsWith("/daily-claim")) return undefined;
      if (++calls === 1) throw new Error("offline");
      return Response.json({
        credited: false,
        wallet: wallet(true, "100"),
        transaction: transaction(),
      });
    });
    render(<CoinWalletView />);
    await screen.findByLabelText("0 монет");
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Получить 100 монет" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Нет соединения",
    );
    expect(screen.getByLabelText("0 монет")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Получить 100 монет" }),
    );
    await screen.findByLabelText("100 монет");
    expect(screen.getByText("Сегодняшний бонус уже получен.")).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("does not submit twice while a claim is pending", async () => {
    let finish!: (response: Response) => void;
    const fetch = api((url) =>
      url.pathname.endsWith("/daily-claim")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    render(<CoinWalletView />);
    await screen.findByLabelText("0 монет");
    const user = userEvent.setup();
    await user.dblClick(
      screen.getByRole("button", { name: "Получить 100 монет" }),
    );
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/daily-claim")),
    ).toHaveLength(1);
    await act(async () =>
      finish(
        Response.json({
          credited: true,
          wallet: wallet(true, "100"),
          transaction: transaction(),
        }),
      ),
    );
    await screen.findByLabelText("100 монет");
  });

  it("reports initial wallet failures and retries without fabricating a balance", async () => {
    let fail = true;
    api((url) => {
      if (url.pathname.endsWith("/wallet") && fail) throw new Error("offline");
      return undefined;
    });
    render(<CoinWalletView />);
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("0 монет")).toBeNull();
    fail = false;
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByLabelText("0 монет");
  });

  it("paginates transaction history, preserving rows on a page failure and deduplicating retries", async () => {
    let fail = true;
    api((url) => {
      if (!url.pathname.endsWith("/transactions")) return undefined;
      if (url.searchParams.has("cursor") && fail) throw new Error("offline");
      return Response.json(
        url.searchParams.has("cursor")
          ? { items: [transaction(1), transaction(2)], nextCursor: null }
          : { items: [transaction(1)], nextCursor: "cursor-2" },
      );
    });
    render(<CoinWalletView />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Показать ещё" }),
    );
    await screen.findByRole("alert");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fail = false;
    await user.click(
      screen.getByRole("button", { name: "Повторить загрузку" }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
  });

  it("hides a previous account balance during session rechecks and identity changes", async () => {
    api((url) =>
      url.pathname.endsWith("/wallet")
        ? Response.json({ wallet: wallet(true, "987654") })
        : undefined,
    );
    const view = render(<CoinWalletView />);
    await screen.findByLabelText("987654 монет");
    identity.checking = true;
    view.rerender(<CoinWalletView />);
    expect(screen.queryByLabelText("987654 монет")).toBeNull();
    identity.checking = false;
    identity.id = uuid(2);
    api((url) =>
      url.pathname.endsWith("/wallet")
        ? new Promise<Response>(() => undefined)
        : undefined,
    );
    view.rerender(<CoinWalletView />);
    expect(screen.queryByLabelText("987654 монет")).toBeNull();
  });

  it("ignores a stale balance response after a successful claim", async () => {
    let count = 0;
    let finish!: (response: Response) => void;
    api((url) => {
      if (url.pathname.endsWith("/wallet") && ++count === 2)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (url.pathname.endsWith("/daily-claim"))
        return Response.json({
          credited: true,
          wallet: wallet(true, "100"),
          transaction: transaction(),
        });
      return undefined;
    });
    const view = render(<CoinWalletView />);
    await screen.findByLabelText("0 монет");
    identity.checking = true;
    view.rerender(<CoinWalletView />);
    identity.checking = false;
    view.rerender(<CoinWalletView />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Получить 100 монет" }));
    await screen.findByLabelText("100 монет");
    await act(async () => finish(Response.json({ wallet: wallet() })));
    expect(screen.getByLabelText("100 монет")).toBeTruthy();
    expect(screen.queryByLabelText("0 монет")).toBeNull();
  });

  it("rechecks eligibility at server midnight independently of the device clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    let midnight = false;
    const fetch = api((url) => {
      if (!url.pathname.endsWith("/wallet")) return undefined;
      const value = wallet(!midnight, "100");
      value.serverTime = midnight
        ? "2026-10-24T19:00:00.100Z"
        : "2026-10-24T18:59:59.000Z";
      if (midnight) value.dailyReward.nextClaimAt = "2026-10-25T19:00:00.000Z";
      return Response.json({ wallet: value });
    });
    await act(async () => {
      render(<CoinWalletView />);
    });
    expect(
      screen.getByRole("button", { name: "Получено сегодня" }),
    ).toBeTruthy();
    midnight = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1101);
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Получить 100 монет",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/wallet")),
    ).toHaveLength(2);
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/daily-claim"))).toBe(
      false,
    );
  });

  it("loads the balance in More and opens the wallet without claiming; guest gets no wallet request", async () => {
    const fetch = api();
    const view = render(<MoreMenu compact />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ещё" }));
    expect(
      (
        await screen.findByRole("menuitem", { name: /Получить монеты/ })
      ).getAttribute("href"),
    ).toBe("/coins");
    await screen.findByLabelText("Баланс 0");
    expect(fetch.mock.calls.some(([url]) => url.endsWith("/daily-claim"))).toBe(
      false,
    );
    view.unmount();
    identity.guest = true;
    fetch.mockClear();
    render(<MoreMenu compact />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ещё" }));
    expect(
      screen.queryByRole("menuitem", { name: /Получить монеты/ }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
