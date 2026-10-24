import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeAccess, useHomeIdentity } from "./home-access";

const account = {
  id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789",
  email: "person@example.test",
  username: "person",
  emailVerified: true,
};
function Feed() {
  const user = useHomeIdentity();
  return (
    <>
      <p>{user?.email ?? "Публикации"}</p>
      <button data-auth-required>Нравится</button>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the guest gate must also intercept plain anchors */}
      <a href="/direct">Сообщения</a>
    </>
  );
}
beforeEach(() => {
  window.history.replaceState(null, "", "/?guest=1");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => vi.unstubAllGlobals());

it("lets guests browse without a banner and asks to log in only on interaction", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ user: null })),
  );
  render(
    <HomeAccess>
      <Feed />
    </HomeAccess>,
  );
  await screen.findByText("Публикации");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Войти" }).getAttribute("href")).toBe(
    "/auth/login",
  );
  fireEvent.click(screen.getByRole("button", { name: "Продолжить просмотр" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Сообщения" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("hides the old identity on focus and ignores a stale session response", async () => {
  let stale!: (response: Response) => void;
  let latest!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ user: account }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          stale = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          latest = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <HomeAccess>
      <Feed />
    </HomeAccess>,
  );
  await screen.findByText(account.email);
  fireEvent(window, new Event("focus"));
  expect(screen.queryByText(account.email)).toBeNull();
  fireEvent(window, new Event("focus"));
  await act(async () => latest(Response.json({ user: null })));
  await screen.findByText("Публикации");
  await act(async () => stale(Response.json({ user: account })));
  expect(screen.queryByText(account.email)).toBeNull();
});

it("does not render content or silently enter as guest when the API fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(
    <HomeAccess>
      <Feed />
    </HomeAccess>,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Публикации")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Попробовать снова" }),
  ).toBeTruthy();
});

function Counter() {
  const [count, setCount] = useState(0);
  const user = useHomeIdentity();
  return (
    <>
      <button onClick={() => setCount(count + 1)}>Счёт {count}</button>
      <p>{user?.email ?? "скрыто"}</p>
    </>
  );
}

it("keeps the feed mounted on focus and remounts it only when the account changes", async () => {
  const other = {
    ...account,
    id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
    email: "other@example.test",
  };
  const fetch = vi
    .fn()
    .mockImplementationOnce(async () => Response.json({ user: account }))
    .mockImplementationOnce(async () => Response.json({ user: account }))
    .mockImplementationOnce(async () => Response.json({ user: other }));
  vi.stubGlobal("fetch", fetch);
  render(
    <HomeAccess>
      <Counter />
    </HomeAccess>,
  );
  await screen.findByText(account.email);
  fireEvent.click(screen.getByRole("button", { name: "Счёт 0" }));
  fireEvent(window, new Event("focus"));
  // Identity hidden while rechecking, but no full-screen loader and no remount.
  expect(screen.getByText("скрыто")).toBeTruthy();
  expect(screen.queryByText("Проверяем сессию…")).toBeNull();
  await screen.findByText(account.email);
  expect(screen.getByRole("button", { name: "Счёт 1" })).toBeTruthy();
  fireEvent(window, new Event("focus"));
  await screen.findByText(other.email);
  expect(screen.getByRole("button", { name: "Счёт 0" })).toBeTruthy();
});

it("allows a signed-in legacy account without verified email", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ user: { ...account, emailVerified: false } }),
      ),
  );
  render(
    <HomeAccess>
      <Feed />
    </HomeAccess>,
  );
  await screen.findByText(account.email);
  fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
