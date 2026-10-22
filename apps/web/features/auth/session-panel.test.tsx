import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { replaceLocation } from "@/lib/navigation";
import { SessionPanel } from "./session-panel";

vi.mock("@/lib/navigation", () => ({ replaceLocation: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(replaceLocation).mockClear(); });
const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
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

it("resends the confirmation to the signed-in address without asking for it", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user }))
    .mockResolvedValueOnce(Response.json({ csrfToken }))
    .mockResolvedValueOnce(Response.json({ status: "accepted" }, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionPanel />);
  await screen.findByRole("heading", { name: "Подтвердите email" });
  expect(screen.queryByRole("textbox")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Отправить письмо повторно" }));
  await screen.findByText(/Письмо отправлено повторно/);
  expect(fetch.mock.calls[2][0]).toBe("/api/v1/auth/verification/request");
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ email: user.email });
});

it("opens the feed once the email is confirmed while the page waits", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user }))
    .mockResolvedValueOnce(Response.json({ user: { ...user, emailVerified: true } }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionPanel />);
  await screen.findByRole("heading", { name: "Подтвердите email" });
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/"));
});

it("does not redirect an already verified account viewing its account page", async () => {
  const fetch = vi.fn(async () => Response.json({ user: { ...user, emailVerified: true } }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionPanel />);
  await screen.findByText("Email подтверждён.");
  fireEvent(window, new Event("focus"));
  await screen.findByText("Email подтверждён.");
  expect(replaceLocation).not.toHaveBeenCalled();
});
