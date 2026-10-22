import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SessionPanel } from "./session-panel";

afterEach(() => vi.unstubAllGlobals());
const user = { id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789", email: "person@example.test", username: "person", emailVerified: false };

it("rechecks identity on focus, hides stale identity, and ignores an older response", async () => {
  let old!: (response: Response) => void;
  let latest!: (response: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { old = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { latest = resolve; }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionPanel />);
  await screen.findByText(user.email);
  fireEvent(window, new Event("focus"));
  expect(screen.queryByText(user.email)).toBeNull();
  fireEvent(window, new Event("focus"));
  await act(async () => latest(Response.json({ user: null })));
  await screen.findByText("Вы не вошли в аккаунт.");
  await act(async () => old(Response.json({ user })));
  expect(screen.queryByText(user.email)).toBeNull();
});

it("removes identity on logout failure without claiming that the session ended", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user })).mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  render(<SessionPanel />);
  await screen.findByText(user.email);
  await userEvent.setup().click(screen.getByRole("button", { name: "Выйти" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(user.email)).toBeNull();
  expect(screen.queryByText("Вы не вошли в аккаунт.")).toBeNull();
  expect(screen.getByRole("button", { name: "Повторить выход" })).toBeTruthy();
});

it("offers a retry when a session lookup fails instead of showing an anonymous session", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ user: null }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionPanel />);
  await screen.findByRole("alert");
  await userEvent.setup().click(screen.getByRole("button", { name: "Попробовать снова" }));
  await waitFor(() => expect(screen.getByText("Вы не вошли в аккаунт.")).toBeTruthy());
});
