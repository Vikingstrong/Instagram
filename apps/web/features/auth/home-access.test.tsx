import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeAccess, useHomeIdentity } from "./home-access";

const account = { id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789", email: "person@example.test", username: "person", emailVerified: true };
function Feed() {
  const user = useHomeIdentity();
  return <><p>{user?.email ?? "Публикации"}</p><button data-auth-required>Нравится</button><a href="/direct">Сообщения</a></>;
}
beforeEach(() => {
  window.history.replaceState(null, "", "/?guest=1");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

it("lets guests browse without a banner and asks to log in only on interaction", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: null })));
  render(<HomeAccess><Feed /></HomeAccess>);
  await screen.findByText("Публикации");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Войти" }).getAttribute("href")).toBe("/auth/login");
  fireEvent.click(screen.getByRole("button", { name: "Продолжить просмотр" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Сообщения" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("hides the old identity on focus and ignores a stale session response", async () => {
  let stale!: (response: Response) => void;
  let latest!: (response: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user: account }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { stale = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { latest = resolve; }));
  vi.stubGlobal("fetch", fetch);
  render(<HomeAccess><Feed /></HomeAccess>);
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
  render(<HomeAccess><Feed /></HomeAccess>);
  await screen.findByRole("alert");
  expect(screen.queryByText("Публикации")).toBeNull();
  expect(screen.getByRole("button", { name: "Попробовать снова" })).toBeTruthy();
});
