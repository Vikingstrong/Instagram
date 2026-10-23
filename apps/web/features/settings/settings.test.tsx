import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MoreMenu } from "@/components/shell/more-menu";
import { ProfileFollowActions } from "@/features/social/profile-follow-actions";
import { replaceLocation } from "@/lib/navigation";

import { AccountSettings } from "./account-settings";
import { PrivacySettings } from "./privacy-settings";
import { ProfileSettings } from "./profile-settings";
import { SettingsShell } from "./settings-shell";

const viewer = {
  id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789",
  email: "person@example.test",
  username: "person",
  emailVerified: true,
};
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => viewer,
  useHomeChecking: () => false,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/accounts/edit" }));
vi.mock("@/lib/navigation", () => ({ replaceLocation: vi.fn() }));

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const own = { id: viewer.id, username: "person", displayName: "", bio: "", isPrivate: false };
const errorBody = (code: string, message: string) => ({
  error: { code, message, requestId: "8f4c5d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f" },
});

type Handler = (init: RequestInit) => Response | Promise<Response>;
function api(routes: Record<string, Handler>) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(input, "http://localhost").pathname}`;
    if (key === "GET /api/v1/auth/csrf") return Response.json({ csrfToken });
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(replaceLocation).mockClear();
});

describe("edit profile", () => {
  it("sends only changed fields, blocks invalid input and confirms saving", async () => {
    let sent: unknown;
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile: own }),
      "PATCH /api/v1/me/profile": (init) => {
        sent = JSON.parse(String(init.body));
        return Response.json({ profile: { ...own, ...(sent as object) } });
      },
    });
    render(<ProfileSettings />);
    const user = userEvent.setup();
    const bio = await screen.findByRole("textbox", { name: /О себе/ });
    const submit = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // Paste instead of typing 151 keystrokes: same input, much faster.
    await user.click(bio);
    await user.paste("x".repeat(151));
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Проверьте введённые данные.");
    await user.clear(bio);
    await user.type(bio, "Привет");
    await user.click(submit);
    expect(await screen.findByText("Профиль сохранён.")).toBeTruthy();
    expect(sent).toEqual({ bio: "Привет" });
  });

  it("moves to the new address after a username change and shows a taken name", async () => {
    let taken = true;
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile: own }),
      "PATCH /api/v1/me/profile": () =>
        taken
          ? Response.json(errorBody("USERNAME_TAKEN", "Username is already taken."), { status: 409 })
          : Response.json({ profile: { ...own, username: "renamed" } }),
    });
    render(<ProfileSettings />);
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: /Имя пользователя/ });
    await user.clear(name);
    await user.type(name, "renamed");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Это имя пользователя уже занято.");
    taken = false;
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/renamed"));
  });
});

describe("privacy", () => {
  it("switches privacy immediately and shows the server state", async () => {
    let isPrivate = false;
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile: { ...own, isPrivate } }),
      "PATCH /api/v1/me/profile": (init) => {
        isPrivate = (JSON.parse(String(init.body)) as { isPrivate: boolean }).isPrivate;
        return Response.json({ profile: { ...own, isPrivate } });
      },
    });
    render(<PrivacySettings />);
    const toggle = await screen.findByRole("switch", { name: "Закрытый аккаунт" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(toggle);
    expect(await screen.findByText("Аккаунт закрыт. Текущие подписчики сохранены.")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(isPrivate).toBe(true);
  });
});

describe("account and sign-out", () => {
  it("shows account data and sends a password change link to the own email", async () => {
    let body: unknown;
    api({
      "POST /api/v1/auth/password/request": (init) => {
        body = JSON.parse(String(init.body));
        return Response.json({ status: "accepted" }, { status: 202 });
      },
    });
    render(<AccountSettings />);
    expect((screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement).value).toBe(viewer.email);
    await userEvent.click(screen.getByRole("button", { name: "Сменить пароль" }));
    expect(await screen.findByText(/Письмо отправлено/)).toBeTruthy();
    expect(body).toEqual({ email: viewer.email });
  });

  it("signs out only after confirmation and keeps the dialog on failure", async () => {
    let fail = true;
    const fetch = api({
      "POST /api/v1/auth/logout": () =>
        fail
          ? Response.json(errorBody("SERVICE_UNAVAILABLE", "Service is temporarily unavailable."), { status: 503 })
          : Response.json({ status: "signed_out" }),
    });
    render(<AccountSettings />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Выйти из аккаунта" }));
    let dialog = screen.getByRole("dialog", { name: "Выйти из аккаунта?" });
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Выйти из аккаунта" }));
    dialog = screen.getByRole("dialog", { name: "Выйти из аккаунта?" });
    await user.click(within(dialog).getByRole("button", { name: "Выйти" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Сервис временно недоступен. Попробуйте позже.",
    );
    expect(replaceLocation).not.toHaveBeenCalled();
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Выйти" }));
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/auth/login"));
  });

  it("offers settings, profile and confirmed sign-out from the rail menu", async () => {
    api({ "POST /api/v1/auth/logout": () => Response.json({ status: "signed_out" }) });
    render(<MoreMenu label="Ещё" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ещё" }));
    const menu = screen.getByRole("menu", { name: "Ещё" });
    expect(within(menu).getByRole("menuitem", { name: "Настройки" }).getAttribute("href")).toBe("/accounts/edit");
    expect(within(menu).getByRole("menuitem", { name: "Ваш профиль" }).getAttribute("href")).toBe("/person");
    await user.click(within(menu).getByRole("menuitem", { name: "Выйти" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Выйти из аккаунта?" })).getByRole("button", { name: "Выйти" }),
    );
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/auth/login"));
  });

  it("marks the current settings section", () => {
    render(<SettingsShell title="Редактировать профиль">x</SettingsShell>);
    const nav = screen.getByRole("navigation", { name: "Настройки" });
    expect(within(nav).getByRole("link", { name: "Редактировать профиль" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Аккаунт" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("profile follow actions", () => {
  const id = "00000000-0000-4000-8000-000000000003";

  it("follows at once and unfollows only after confirmation", async () => {
    const changes: string[] = [];
    api({
      [`POST /api/v1/users/${id}/follow`]: () => Response.json({ relationship: "following" }),
      [`DELETE /api/v1/users/${id}/follow`]: () => Response.json({ relationship: "none" }),
    });
    render(
      <ProfileFollowActions
        userId={id}
        username="user_3"
        isPrivate
        relationship="none"
        onChange={(state) => changes.push(state)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Подписаться" }));
    await user.click(await screen.findByRole("button", { name: "Подписки" }));
    const dialog = screen.getByRole("dialog", { name: "Отменить подписку на @user_3?" });
    expect(within(dialog).getByText(/нужно будет отправить запрос/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(screen.getByRole("button", { name: "Подписки" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Подписки" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Отменить подписку" }),
    );
    expect(await screen.findByRole("button", { name: "Подписаться" })).toBeTruthy();
    expect(changes).toEqual(["following", "none"]);
  });

  it("cancels a pending request after confirmation", async () => {
    api({
      [`DELETE /api/v1/users/${id}/follow`]: () => Response.json({ relationship: "none" }),
    });
    render(
      <ProfileFollowActions userId={id} username="user_3" isPrivate relationship="requested" onChange={() => {}} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Запрос отправлен" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Отменить запрос на подписку?" })).getByRole("button", {
        name: "Отменить запрос",
      }),
    );
    expect(await screen.findByRole("button", { name: "Подписаться" })).toBeTruthy();
  });
});
