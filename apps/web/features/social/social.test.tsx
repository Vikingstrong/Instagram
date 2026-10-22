import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RightSidebar } from "@/components/home/right-sidebar";
import { SuggestionsCarousel } from "@/components/home/suggestions-carousel";
import { replaceLocation } from "@/lib/navigation";

import { FollowRequests } from "./follow-requests";
import { ProfileSettings } from "./profile-settings";
import { plural, ProfileView } from "./profile-view";
import { SuggestionsProvider } from "./suggestions";
import { UserSearch } from "./user-search";

const viewer = {
  id: "4f70d2ab-d6d6-4243-b0d3-f7b767434789",
  email: "person@example.test",
  username: "person",
  emailVerified: true,
};
const identity = vi.hoisted(() => ({ user: null as unknown }));
const route = vi.hoisted(() => ({ username: "person" }));
vi.mock("@/features/auth/home-access", () => ({
  useHomeIdentity: () => identity.user,
  useHomeChecking: () => false,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ username: route.username }),
}));
vi.mock("@/lib/navigation", () => ({ replaceLocation: vi.fn() }));

const csrfToken = `${"a".repeat(43)}.1792640000.${"b".repeat(43)}`;
const card = (n: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  username: `user_${n}`,
  displayName: `User ${n}`,
  avatarUrl: null,
  isPrivate: false,
  ...extra,
});
const errorBody = (code: string, message: string) => ({
  error: { code, message, requestId: "8f4c5d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f" },
});

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
// Routes "METHOD /path" to handlers; CSRF is always granted.
function api(routes: Record<string, Handler>) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const key = `${init.method} ${url.pathname}`;
    if (key === "GET /api/v1/auth/csrf") return Response.json({ csrfToken });
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const calls = (fetch: ReturnType<typeof api>, key: string) =>
  fetch.mock.calls.filter(
    ([input, init]) =>
      `${init.method} ${new URL(input, "http://localhost").pathname}` === key,
  );

beforeEach(() => {
  identity.user = viewer;
  route.username = "person";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(replaceLocation).mockClear();
});

describe("suggestions", () => {
  function Home() {
    return (
      <SuggestionsProvider>
        <SuggestionsCarousel />
        <RightSidebar />
      </SuggestionsProvider>
    );
  }

  it("shows API accounts once for both blocks and shares the follow state", async () => {
    const fetch = api({
      "GET /api/v1/me/suggestions": () =>
        Response.json({ items: [card(1), card(2, { isPrivate: true })] }),
      "POST /api/v1/users/00000000-0000-4000-8000-000000000002/follow": () =>
        Response.json({ relationship: "requested" }),
    });
    render(<Home />);
    expect(await screen.findAllByText("Рекомендации для вас")).not.toHaveLength(0);
    expect(calls(fetch, "GET /api/v1/me/suggestions")).toHaveLength(1);
    const [carouselButton] = screen.getAllByRole("button", {
      name: "Подписаться: user_2",
    });
    await userEvent.click(carouselButton!);
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Запрос отправлен: user_2" }),
      ).toHaveLength(2),
    );
    await userEvent.click(screen.getByRole("button", { name: "Скрыть user_1" }));
    expect(screen.queryByRole("button", { name: "Подписаться: user_1" })).toBeNull();
  });

  it("hides every suggestions block when the list is empty or fails", async () => {
    api({ "GET /api/v1/me/suggestions": () => Response.json({ items: [] }) });
    const { unmount } = render(<Home />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText("Рекомендации для вас")).toBeNull();
    unmount();
    api({
      "GET /api/v1/me/suggestions": () =>
        Response.json(errorBody("SERVICE_UNAVAILABLE", "Service is temporarily unavailable."), { status: 503 }),
    });
    render(<Home />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText("Рекомендации для вас")).toBeNull();
  });

  it("does not request suggestions for guests", () => {
    identity.user = null;
    const fetch = api({});
    render(<Home />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Рекомендации для вас")).toBeNull();
  });
});

describe("profile page", () => {
  const profile = {
    ...card(3),
    bio: "Первая строка\nвторая",
    counts: { posts: 0, followers: 21, following: 3 },
    relationship: "none",
  };

  it("shows counters, follows and refreshes the profile from the API", async () => {
    route.username = "user_3";
    let relationship = "none";
    api({
      "GET /api/v1/users/user_3": () =>
        Response.json({ profile: { ...profile, relationship } }),
      [`POST /api/v1/users/${profile.id}/follow`]: () => {
        relationship = "following";
        return Response.json({ relationship });
      },
    });
    render(<ProfileView />);
    expect(await screen.findByRole("heading", { name: "user_3" })).toBeTruthy();
    expect(screen.getByText("21 подписчик")).toBeTruthy();
    expect(screen.getByText("3 подписки")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Подписаться: user_3" }));
    expect(
      await screen.findByRole("button", { name: "Вы подписаны: user_3" }),
    ).toBeTruthy();
  });

  it("hides posts and lists of a private profile from non-followers", async () => {
    route.username = "user_3";
    api({
      "GET /api/v1/users/user_3": () =>
        Response.json({ profile: { ...profile, isPrivate: true } }),
    });
    render(<ProfileView />);
    expect(await screen.findByText("Это закрытый аккаунт")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "21 подписчик" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("offers editing on the own profile and lets the owner remove followers", async () => {
    const follower = card(4);
    const fetch = api({
      "GET /api/v1/users/person": () =>
        Response.json({
          profile: { ...profile, id: viewer.id, username: "person", relationship: "self" },
        }),
      [`GET /api/v1/users/${viewer.id}/followers`]: () =>
        Response.json({ items: [follower], nextCursor: null }),
      [`DELETE /api/v1/me/followers/${follower.id}`]: () =>
        Response.json({ status: "removed" }),
    });
    render(<ProfileView />);
    expect(
      (await screen.findByRole("link", { name: "Редактировать профиль" })).getAttribute("href"),
    ).toBe("/accounts/edit");
    await userEvent.click(screen.getByRole("button", { name: "21 подписчик" }));
    const dialog = await screen.findByRole("dialog", { name: "Подписчики" });
    await userEvent.click(
      await within(dialog).findByRole("button", { name: "Удалить подписчика user_4" }),
    );
    await waitFor(() => expect(within(dialog).queryByText("user_4")).toBeNull());
    expect(calls(fetch, "GET /api/v1/users/person").length).toBeGreaterThan(1);
  });

  it("shows the unavailable page for unknown users", async () => {
    route.username = "missing_user";
    api({
      "GET /api/v1/users/missing_user": () =>
        Response.json(errorBody("USER_NOT_FOUND", "User not found."), { status: 404 }),
    });
    render(<ProfileView />);
    expect(
      await screen.findByText("К сожалению, эта страница недоступна"),
    ).toBeTruthy();
  });

  it("pluralizes Russian counters", () => {
    expect(plural(1, ["a", "b", "c"])).toBe("1 a");
    expect(plural(3, ["a", "b", "c"])).toBe("3 b");
    expect(plural(11, ["a", "b", "c"])).toBe("11 c");
    expect(plural(22, ["a", "b", "c"])).toBe("22 b");
  });
});

describe("profile settings", () => {
  const own = {
    id: viewer.id,
    username: "person",
    displayName: "",
    bio: "",
    isPrivate: false,
  };

  it("sends only changed fields and blocks invalid input", async () => {
    let sent: unknown;
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile: own }),
      "PATCH /api/v1/me/profile": (_url, init) => {
        sent = JSON.parse(String(init.body));
        return Response.json({ profile: { ...own, ...(sent as object) } });
      },
    });
    render(<ProfileSettings />);
    const user = userEvent.setup();
    const bio = await screen.findByRole("textbox", { name: /О себе/ });
    const submit = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(bio, "x".repeat(151));
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Проверьте введённые данные.");
    await user.clear(bio);
    await user.type(bio, "Привет");
    await user.click(screen.getByRole("switch"));
    await user.click(submit);
    expect(await screen.findByText("Профиль сохранён.")).toBeTruthy();
    expect(sent).toEqual({ bio: "Привет", isPrivate: true });
  });

  it("moves to the new profile address after a username change", async () => {
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile: own }),
      "PATCH /api/v1/me/profile": () =>
        Response.json({ profile: { ...own, username: "renamed" } }),
    });
    render(<ProfileSettings />);
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: /Имя пользователя/ });
    await user.clear(name);
    await user.type(name, "renamed");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/renamed"));
  });

  it("shows a taken username error", async () => {
    api({
      "GET /api/v1/me/profile": () => Response.json({ profile: own }),
      "PATCH /api/v1/me/profile": () =>
        Response.json(errorBody("USERNAME_TAKEN", "Username is already taken."), { status: 409 }),
    });
    render(<ProfileSettings />);
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: /Имя пользователя/ });
    await user.type(name, "x");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Это имя пользователя уже занято.",
    );
  });
});

describe("follow requests", () => {
  it("accepts, declines and drops requests already handled elsewhere", async () => {
    const [first, second, third] = [card(5), card(6), card(7)];
    api({
      "GET /api/v1/me/follow-requests": () =>
        Response.json({
          items: [first, second, third].map((user) => ({
            user,
            requestedAt: "2026-10-22T10:00:00.000Z",
          })),
          nextCursor: null,
        }),
      [`POST /api/v1/me/follow-requests/${first!.id}/accept`]: () =>
        Response.json({ status: "accepted" }),
      [`POST /api/v1/me/follow-requests/${second!.id}/decline`]: () =>
        Response.json({ status: "declined" }),
      [`POST /api/v1/me/follow-requests/${third!.id}/accept`]: () =>
        Response.json(errorBody("FOLLOW_REQUEST_NOT_FOUND", "Follow request not found."), { status: 404 }),
    });
    render(<FollowRequests />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Подтвердить запрос user_5" }));
    await user.click(screen.getByRole("button", { name: "Удалить запрос user_6" }));
    await user.click(screen.getByRole("button", { name: "Подтвердить запрос user_7" }));
    expect(await screen.findByText("Новых запросов нет.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("user search", () => {
  it("debounces typing, trims the query and pages results", async () => {
    const fetch = api({
      "GET /api/v1/search/users": (url) =>
        Response.json(
          url.searchParams.get("cursor")
            ? { items: [card(9)], nextCursor: null }
            : { items: [card(8, { isPrivate: true })], nextCursor: "bmV4dA" },
        ),
    });
    render(<UserSearch />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "  us ");
    expect(await screen.findByText("user_8")).toBeTruthy();
    const searches = calls(fetch, "GET /api/v1/search/users");
    expect(searches).toHaveLength(1);
    expect(new URL(searches[0]![0], "http://localhost").searchParams.get("q")).toBe("us");
    expect(screen.getByText("User 8 · Закрытый аккаунт")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("user_9")).toBeTruthy();
    expect(screen.getByText("user_8")).toBeTruthy();
    await user.clear(screen.getByRole("searchbox"));
    expect(screen.queryByText("user_8")).toBeNull();
  });

  it("reports an empty result", async () => {
    api({
      "GET /api/v1/search/users": () => Response.json({ items: [], nextCursor: null }),
    });
    render(<UserSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("Ничего не найдено.")).toBeTruthy();
  });
});
